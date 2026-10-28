// CSV import/export. RFC 4180 quoting; tolerant header aliases on import.
import { type Circuit, type Doc, type Panel, blankPanel, normalizeCircuit, parseProtection } from "./model";

export const CSV_COLUMNS = ["panel", "slot", "amps", "poles", "tandem", "circuit", "protection", "note", "verify"] as const;

function esc(v: string): string {
  return /[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCSV(panels: Panel[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const p of panels)
    for (const c of p.circuits)
      lines.push([p.name, c.slot, c.amps, String(c.poles), c.tandem ? "y" : "", c.name, c.prot, c.note, c.verify ? "y" : ""].map(esc).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** Parse CSV text into rows of fields. Handles quotes, escaped quotes, CRLF/LF, embedded newlines. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], f = "", q = false, i = 0;
  const t = text.replace(/^﻿/, "");
  while (i < t.length) {
    const ch = t[i];
    if (q) {
      if (ch === '"') {
        if (t[i + 1] === '"') { f += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      f += ch; i++; continue;
    }
    if (ch === '"' && f === "") { q = true; i++; continue; }
    if (ch === ",") { row.push(f); f = ""; i++; continue; }
    if (ch === "\r" || ch === "\n") {
      row.push(f); f = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      i += ch === "\r" && t[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    f += ch; i++;
  }
  row.push(f);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

const ALIASES: Record<string, string[]> = {
  panel: ["panel", "panel_name", "board"],
  slot: ["slot", "position", "space", "breaker", "number", "no", "#"],
  amps: ["amps", "amp", "a", "rating", "size"],
  poles: ["poles", "pole", "p"],
  tandem: ["tandem", "twin"],
  circuit: ["circuit", "name", "description", "load", "label"],
  protection: ["protection", "prot", "type"],
  note: ["note", "notes", "comment", "comments"],
  verify: ["verify", "uncertain", "unverified", "check"],
};

const truthy = (s: string) => /^(y|yes|true|1|x|\?)$/i.test(s.trim());

export interface ImportedPanel { name: string | null; circuits: Circuit[] }

/** CSV -> circuits grouped by panel name (null when there is no panel column). */
export function fromCSV(text: string): ImportedPanel[] {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col: Record<string, number> = {};
  for (const [k, names] of Object.entries(ALIASES)) {
    const j = head.findIndex((h) => names.includes(h));
    if (j >= 0) col[k] = j;
  }
  if (col.slot == null) throw new Error("CSV needs a 'slot' column (header row required).");
  const get = (r: string[], k: string) => (col[k] == null ? "" : (r[col[k]] ?? "").trim());
  const groups = new Map<string | null, Circuit[]>();
  for (const r of rows.slice(1)) {
    const name = col.panel == null ? null : get(r, "panel");
    let slot = get(r, "slot");
    let poles = Number(get(r, "poles"));
    const explicit = slot.split(/[-/,&]+/).filter(Boolean).length;
    if (!(poles >= 1 && poles <= 3)) poles = explicit >= 2 && explicit <= 3 ? explicit : 1;
    const c = normalizeCircuit({
      slot, amps: get(r, "amps"), poles, tandem: truthy(get(r, "tandem")),
      name: get(r, "circuit"), prot: parseProtection(get(r, "protection")), note: get(r, "note"),
      verify: truthy(get(r, "verify")),
    });
    slot = c.slot;
    if (!slot && !c.name && !c.amps) continue;
    const list = groups.get(name) ?? [];
    list.push(c);
    groups.set(name, list);
  }
  return [...groups].map(([name, circuits]) => ({ name, circuits }));
}

/** Merge an import into a doc: same-named panels get their circuits replaced; unnamed imports
 *  replace the active panel; new names become new panels sized to fit. Returns the index to show. */
export function mergeImport(doc: Doc, active: number, imported: ImportedPanel[]): number {
  let show = active;
  for (const imp of imported) {
    let idx = imp.name == null ? active : doc.panels.findIndex((p) => p.name === imp.name);
    if (idx < 0 && imported.length === 1 && doc.panels[active] && doc.panels[active].circuits.length === 0) idx = active;
    if (idx < 0) {
      const p = blankPanel(imp.name || "Imported panel");
      doc.panels.push(p);
      idx = doc.panels.length - 1;
    }
    const p = doc.panels[idx];
    p.circuits = imp.circuits;
    if (imp.name && (p.name === "New panel" || !p.name)) p.name = imp.name;
    const maxSlot = Math.max(0, ...imp.circuits.flatMap((c) => (c.slot.match(/\d+/g) ?? []).map(Number)));
    const maxOcc = Math.max(0, ...imp.circuits.map((c) => (Number(c.slot.match(/\d+/)?.[0]) || 0) + (c.poles - 1) * 2));
    const need = Math.max(maxSlot, maxOcc);
    if (need > p.spaces) p.spaces = need + (need % 2);
    show = idx;
  }
  return show;
}

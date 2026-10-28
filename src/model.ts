// Data model, panel geometry, leg assignment, validation and load summary.
// Pure functions only: no DOM, so everything here is unit-tested in node.

export type Protection = "" | "AFCI" | "GFCI" | "DFCI" | "GFCI-R";
export const PROTECTIONS: Protection[] = ["", "AFCI", "GFCI", "DFCI", "GFCI-R"];
export const PROT_LABEL: Record<Protection, string> = {
  "": "std",
  AFCI: "AFCI",
  GFCI: "GFCI",
  DFCI: "DFCI",
  "GFCI-R": "GFCI-rcpt",
};
export const PROT_TITLE: Record<Protection, string> = {
  "": "standard thermal-magnetic breaker",
  AFCI: "arc-fault (AFCI / CAFCI) breaker",
  GFCI: "ground-fault (GFCI) breaker",
  DFCI: "dual-function AFCI+GFCI breaker",
  "GFCI-R": "standard breaker, GFCI protection at a receptacle downstream",
};

export type Poles = 1 | 2 | 3;
/** odd-even: odd slots down the left, even down the right (most North American load centers).
 *  sequential: 1..N/2 down the left column, then continue down the right (some transfer switches, older/DIN panels). */
export type Numbering = "odd-even" | "sequential";
/** split: 120/240 V single-phase, two legs (A/B). three: 208Y/120 or 480Y/277, three legs (A/B/C). */
export type System = "split" | "three";
export type Leg = "A" | "B" | "C";

export interface Circuit {
  /** "7", or an explicit pole list like "7-9" / "7/9" / "7,9". */
  slot: string;
  /** Handle rating as read; a trailing "?" marks an unverified reading ("15?"). */
  amps: string;
  poles: Poles;
  /** Tandem/twin (two circuits in one space). Two tandem 2-poles in the same slots = a quad. */
  tandem: boolean;
  name: string;
  prot: Protection;
  note: string;
  /** Explicit "needs verification" flag. */
  verify: boolean;
}

export interface Panel {
  id: string;
  name: string;
  location: string;
  brand: string;
  mainAmps: number;
  spaces: number;
  numbering: Numbering;
  system: System;
  date: string;
  verifiedBy: string;
  notes: string;
  circuits: Circuit[];
}

export interface Doc {
  v: 1;
  panels: Panel[];
}

// ---------------------------------------------------------------- constructors

let idCounter = 0;
export function newId(): string {
  idCounter = (idCounter + 1) % 1e6;
  return Date.now().toString(36) + idCounter.toString(36) + Math.random().toString(36).slice(2, 6);
}

export function blankCircuit(slot = ""): Circuit {
  return { slot, amps: "", poles: 1, tandem: false, name: "", prot: "", note: "", verify: false };
}

export function blankPanel(name = "New panel"): Panel {
  return {
    id: newId(), name, location: "", brand: "", mainAmps: 200, spaces: 40,
    numbering: "odd-even", system: "split", date: "", verifiedBy: "", notes: "", circuits: [],
  };
}

/** Coerce arbitrary parsed JSON (old saves, hand edits, share links) into a valid Doc. */
export function normalizeDoc(raw: unknown): Doc {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const panels = Array.isArray(o.panels) ? o.panels.map(normalizePanel) : [];
  return { v: 1, panels };
}

export function normalizePanel(raw: unknown): Panel {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const b = blankPanel();
  const str = (k: string, d: string) => (typeof o[k] === "string" ? (o[k] as string) : d);
  const num = (k: string, d: number) => {
    const n = Number(o[k]);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    id: str("id", b.id) || b.id,
    name: str("name", b.name),
    location: str("location", ""),
    brand: str("brand", ""),
    mainAmps: num("mainAmps", b.mainAmps),
    spaces: Math.min(84, Math.round(num("spaces", b.spaces))),
    numbering: o.numbering === "sequential" ? "sequential" : "odd-even",
    system: o.system === "three" ? "three" : "split",
    date: str("date", ""),
    verifiedBy: str("verifiedBy", ""),
    notes: str("notes", ""),
    circuits: Array.isArray(o.circuits) ? o.circuits.map(normalizeCircuit) : [],
  };
}

export function normalizeCircuit(raw: unknown): Circuit {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (k: string) => (o[k] == null ? "" : String(o[k]));
  const p = Number(o.poles);
  const prot = PROTECTIONS.includes(o.prot as Protection) ? (o.prot as Protection) : parseProtection(s("prot"));
  return {
    slot: s("slot").trim(),
    amps: s("amps").trim(),
    poles: p === 2 || p === 3 ? p : 1,
    tandem: o.tandem === true || o.tandem === "true" || o.tandem === 1,
    name: s("name"),
    prot,
    note: s("note"),
    verify: o.verify === true || o.verify === "true" || o.verify === 1,
  };
}

/** Lenient protection parser for imports ("CAFCI", "AFCI/GFCI", "gfci outlet" ...). */
export function parseProtection(s: string): Protection {
  const t = s.trim().toUpperCase();
  if (!t || t === "STD" || t === "STANDARD" || t === "-") return "";
  const a = /AFCI|ARC/.test(t), g = /GFCI|GFI|GROUND/.test(t);
  if (/DFCI|DUAL/.test(t) || (a && g)) return "DFCI";
  if (g && /RECEP|OUTLET|-R\b|RCPT/.test(t)) return "GFCI-R";
  if (g) return "GFCI";
  if (a) return "AFCI";
  return "";
}

// ---------------------------------------------------------------- amps / uncertainty

export interface Amps { value: number | null; uncertain: boolean }

export function parseAmps(a: string): Amps {
  const t = (a ?? "").trim();
  const uncertain = /[?~]/.test(t);
  const m = t.match(/\d+(\.\d+)?/);
  return { value: m ? Number(m[0]) : null, uncertain };
}

export function isUncertain(c: Circuit): boolean {
  return c.verify || parseAmps(c.amps).uncertain || /\bverify\b|\?$/i.test(c.note.trim()) || /\?/.test(c.slot);
}

// ---------------------------------------------------------------- geometry

export function rowsPerColumn(p: Panel): number {
  return Math.ceil(p.spaces / 2);
}

/** Next slot in the same column (one row down). */
export function slotStep(p: Panel): number {
  return p.numbering === "odd-even" ? 2 : 1;
}

export interface Pos { col: 0 | 1; row: number }

/** Physical position of a slot; rows are 1-based from the top. */
export function position(p: Panel, slot: number): Pos | null {
  if (!Number.isInteger(slot) || slot < 1 || slot > p.spaces) return null;
  if (p.numbering === "odd-even") return { col: slot % 2 ? 0 : 1, row: Math.ceil(slot / 2) };
  const half = rowsPerColumn(p);
  return slot <= half ? { col: 0, row: slot } : { col: 1, row: slot - half };
}

/** Slot number at a physical position (inverse of position). */
export function slotAt(p: Panel, col: 0 | 1, row: number): number {
  return p.numbering === "odd-even" ? 2 * row - 1 + col : row + col * rowsPerColumn(p);
}

/** Bus stabs alternate down the panel: each row is one leg, both columns share it. */
export function legOfRow(p: Panel, row: number): Leg {
  if (p.system === "three") return (["A", "B", "C"] as const)[(row - 1) % 3];
  return row % 2 ? "A" : "B";
}

export function legOfSlot(p: Panel, slot: number): Leg | null {
  const pos = position(p, slot);
  return pos ? legOfRow(p, pos.row) : null;
}

export function legsFor(p: Panel): Leg[] {
  return p.system === "three" ? ["A", "B", "C"] : ["A", "B"];
}

/** Parse the slot field: "7" -> [7]; "7-9", "7/9", "7,9", "7 & 9" -> [7, 9]. */
export function parseSlot(s: string): number[] | null {
  const parts = (s ?? "").split(/[-/,&+\s]+/).map((x) => x.replace(/[^\d]/g, "")).filter(Boolean);
  if (!parts.length) return null;
  const nums = parts.map(Number);
  return nums.every((n) => Number.isInteger(n) && n > 0) ? nums : null;
}

/** Physical slots a circuit occupies. An explicit list wins when it has the right length;
 *  otherwise poles stack downward in the same column starting at the first slot. */
export function occupiedSlots(p: Panel, c: Circuit): number[] {
  const parsed = parseSlot(c.slot);
  if (!parsed) return [];
  if (parsed.length === c.poles) return parsed;
  const st = slotStep(p);
  return Array.from({ length: c.poles }, (_, i) => parsed[0] + i * st);
}

export function firstSlot(c: Circuit): number {
  const s = parseSlot(c.slot);
  return s ? s[0] : Number.POSITIVE_INFINITY;
}

export function slotLabel(p: Panel, c: Circuit): string {
  const occ = occupiedSlots(p, c);
  return occ.length ? occ.join("-") : c.slot || "?";
}

/** Stable display order: by first slot, then original index (keeps tandem a/b order). */
export function sortedCircuits(p: Panel): { c: Circuit; i: number }[] {
  return p.circuits
    .map((c, i) => ({ c, i }))
    .sort((x, y) => firstSlot(x.c) - firstSlot(y.c) || x.i - y.i);
}

// ---------------------------------------------------------------- validation

export type Level = "error" | "warn" | "info";
export interface Finding { level: Level; circuit: number | null; code: string; msg: string }

const GFCI_TYPICAL = /\b(bath|bathroom|kitchen|counter|countertop|laundry|washer|garage|outdoor|outside|exterior|porch|patio|deck|basement|crawl|pool|spa|hot ?tub|whirlpool|jacuzzi|dishwasher|wet ?bar|sink|boat|ev\b|car charger)/i;
const AFCI_TYPICAL = /\b(bed ?room|bdrm|living|family|dining|den|hall|hallway|closet|office|study|library|rec ?room|parlor|sunroom|great room|nursery)/i;
/** Lighting/fixed-equipment circuits: the GFCI receptacle rules don't obviously apply. */
const NOT_RECEPTACLE = /\b(lights?|lighting|light fixture|fans?|smoke|detectors?|furnace|blower|doorbell)\b/i;
const GFCI_OK: Protection[] = ["GFCI", "DFCI", "GFCI-R"];
const AFCI_OK: Protection[] = ["AFCI", "DFCI"];

export function validate(p: Panel): Finding[] {
  const out: Finding[] = [];
  const add = (level: Level, circuit: number | null, code: string, msg: string) => out.push({ level, circuit, code, msg });
  const occ = new Map<number, { i: number; w: number; tandem: boolean }[]>();

  if (p.numbering === "odd-even" && p.spaces % 2) add("info", null, "odd-spaces", `${p.spaces} spaces with odd/even numbering leaves one column a space short.`);

  p.circuits.forEach((c, i) => {
    const tag = `#${c.slot || "?"}${c.name ? ` ${c.name}` : ""}`;
    const parsed = parseSlot(c.slot);
    if (!parsed) {
      if (c.slot || c.name || c.amps) add("error", i, "slot", `${tag}: slot "${c.slot}" isn't a number.`);
      return;
    }
    const slots = occupiedSlots(p, c);
    if (parsed.length > 1 && parsed.length !== c.poles)
      add("warn", i, "slot-count", `${tag}: slot lists ${parsed.length} positions but poles = ${c.poles}; using ${slots.join("-")}.`);
    const bad = slots.filter((s) => !position(p, s));
    if (bad.length) add("error", i, "range", `${tag}: slot ${bad.join(", ")} is outside this ${p.spaces}-space panel.`);
    const pos = slots.map((s) => position(p, s)).filter((x): x is Pos => !!x);
    if (c.poles > 1 && pos.length === slots.length) {
      const legs = pos.map((x) => legOfRow(p, x.row));
      if (new Set(legs).size < legs.length)
        add("error", i, "same-leg", `${tag}: poles ${slots.join("-")} land on the same leg (${legs.join("/")}). A ${c.poles}-pole breaker can't do that; the slot numbering is probably off.`);
      if (new Set(pos.map((x) => x.col)).size > 1)
        add("error", i, "span-col", `${tag}: poles ${slots.join("-")} are in different columns.`);
      const rows = pos.map((x) => x.row).sort((a, b) => a - b);
      if (rows.some((r, k) => k > 0 && r !== rows[k - 1] + 1))
        add("warn", i, "non-adjacent", `${tag}: poles ${slots.join("-")} aren't in adjacent rows (needs a handle tie, or a typo).`);
    }
    if (c.poles === 3 && p.system === "split")
      add("warn", i, "3p-split", `${tag}: 3-pole breaker in a split-phase (120/240 V) panel; set the system to 3-phase if that's what this is.`);
    for (const s of slots) {
      if (!position(p, s)) continue;
      const list = occ.get(s) ?? [];
      list.push({ i, w: c.tandem ? 0.5 : 1, tandem: c.tandem });
      occ.set(s, list);
    }
    const a = parseAmps(c.amps);
    if (a.value == null) add("warn", i, "amps", `${tag}: no amp rating.`);
    else if (a.value > p.mainAmps) add("warn", i, "amps-main", `${tag}: ${a.value} A breaker is larger than the ${p.mainAmps} A main.`);
    if (isUncertain(c)) add("info", i, "uncertain", `${tag}: marked unverified; it prints with a "verify" chip.`);
    if (c.poles === 1 && c.name) {
      const lighting = NOT_RECEPTACLE.test(c.name);
      if (GFCI_TYPICAL.test(c.name) && !lighting && !GFCI_OK.includes(c.prot))
        add("info", i, "gfci-typical", `${tag}: GFCI protection is typical for this kind of circuit in recent code cycles (may be at a receptacle; older work is often grandfathered).`);
      else if (AFCI_TYPICAL.test(c.name) && !GFCI_TYPICAL.test(c.name) && !AFCI_OK.includes(c.prot))
        add("info", i, "afci-typical", `${tag}: AFCI protection is typical for this kind of circuit in recent code cycles (older work is often grandfathered).`);
    }
  });

  for (const [s, list] of [...occ].sort((a, b) => a[0] - b[0])) {
    const w = list.reduce((t, x) => t + x.w, 0);
    if (w > 1 || list.filter((x) => x.tandem).length > 2) {
      const who = [...new Set(list.map((x) => x.i))];
      add("error", who[who.length - 1], "overlap", `Slot ${s} is claimed by ${list.length} breakers (${who.map((i) => `"${p.circuits[i].name || p.circuits[i].slot}"`).join(", ")}). Tandems must both be marked tandem.`);
    }
  }

  const sm = summarize(p);
  if (sm.free <= 0) add("info", null, "full", "No free spaces left.");
  if (sm.worstRatio > 3) add("warn", null, "oversub", `Worst leg's connected breaker total is ${sm.worstRatio.toFixed(1)}x the ${p.mainAmps} A main. 2-3x is normal; beyond that, check that the demand load really fits.`);
  return out;
}

// ---------------------------------------------------------------- loading summary

export interface Summary {
  legs: Record<Leg, number>;
  left: number;
  right: number;
  n1: number;
  n2: number;
  n3: number;
  a240: number;
  a120: number;
  occupied: number;
  free: number;
  worstLeg: Leg;
  worstAmps: number;
  worstRatio: number;
  uncertain: number;
  tandems: number;
}

/** Connected load = sum of handle ratings per leg. A multi-pole breaker counts its full rating
 *  on every leg it lands on. Column totals are amp-poles. This is a capacity/balance measure,
 *  not an NEC demand calculation. Ratings with "?" count at the number read. */
export function summarize(p: Panel): Summary {
  const legs: Record<Leg, number> = { A: 0, B: 0, C: 0 };
  let left = 0, right = 0, n1 = 0, n2 = 0, n3 = 0, a240 = 0, a120 = 0, uncertain = 0, tandems = 0;
  const used = new Set<number>();
  for (const c of p.circuits) {
    const slots = occupiedSlots(p, c).filter((s) => position(p, s));
    if (!slots.length) continue;
    const a = parseAmps(c.amps).value ?? 0;
    for (const s of slots) {
      const pos = position(p, s)!;
      legs[legOfRow(p, pos.row)] += a;
      if (pos.col === 0) left += a; else right += a;
      used.add(s);
    }
    if (c.poles === 1) { n1++; a120 += a; } else { if (c.poles === 2) n2++; else n3++; a240 += a; }
    if (isUncertain(c)) uncertain++;
    if (c.tandem) tandems++;
  }
  const ls = legsFor(p);
  const worstLeg = ls.reduce((m, l) => (legs[l] > legs[m] ? l : m), ls[0]);
  const worstAmps = legs[worstLeg];
  return {
    legs, left, right, n1, n2, n3, a240, a120,
    occupied: used.size, free: p.spaces - used.size,
    worstLeg, worstAmps, worstRatio: p.mainAmps > 0 ? worstAmps / p.mainAmps : 0,
    uncertain, tandems,
  };
}

/** Imbalance between the most- and least-loaded legs, as a fraction of the most-loaded. */
export function imbalance(p: Panel, s: Summary = summarize(p)): number {
  const v = legsFor(p).map((l) => s.legs[l]);
  const hi = Math.max(...v), lo = Math.min(...v);
  return hi > 0 ? (hi - lo) / hi : 0;
}

import "./style.css";
import {
  type Circuit, type Doc, type Panel, type Poles, type Protection, PROTECTIONS, PROT_LABEL,
  blankCircuit, blankPanel, legOfSlot, newId, normalizeDoc, occupiedSlots, sortedCircuits, validate,
} from "./model";
import { fromCSV, mergeImport, toCSV } from "./csv";
import { decodeDoc, encodeDoc } from "./share";
import { EXAMPLES, exampleDoc } from "./examples";
import { CARD_SIZES, LABEL_PRESETS, type LabelPreset, renderCard, renderLabels, renderLoading } from "./render";

const STORE = "loadcenterlabels:v1";
type View = "card" | "labels" | "load";
interface UI {
  view: View; cardSize: string; cardW: number; cardH: number; notes: boolean; tally: boolean; all: boolean;
  lbl: LabelPreset; startAt: number; spares: boolean; lblPanel: boolean;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let doc: Doc = { v: 1, panels: [] };
let active = 0;
let ui: UI = {
  view: "card", cardSize: "letter", cardW: 7.5, cardH: 10, notes: true, tally: true, all: false,
  lbl: { ...LABEL_PRESETS[0] }, startAt: 1, spares: false, lblPanel: false,
};

const P = (): Panel => doc.panels[active];

// ---------------------------------------------------------------- persistence

function saveNow() {
  try { localStorage.setItem(STORE, JSON.stringify({ doc, active, ui })); } catch { /* private mode / quota: fine */ }
}
let saveT = 0;
function save() { clearTimeout(saveT); saveT = window.setTimeout(saveNow, 250); }

function readStored(): { doc: Doc; active: number } | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (o.ui && typeof o.ui === "object") ui = { ...ui, ...o.ui, lbl: { ...ui.lbl, ...(o.ui.lbl ?? {}) } };
    const d = normalizeDoc(o.doc);
    if (!d.panels.length) return null;
    return { doc: d, active: Math.min(Math.max(0, Number(o.active) || 0), d.panels.length - 1) };
  } catch { return null; }
}

let statusT = 0;
function status(msg: string) {
  const s = $("status");
  s.textContent = msg;
  clearTimeout(statusT);
  statusT = window.setTimeout(() => (s.textContent = ""), 6000);
}

// ---------------------------------------------------------------- panel meta

const META = ["name", "location", "brand", "mainAmps", "spaces", "numbering", "system", "date", "verifiedBy", "notes"] as const;

function renderMeta() {
  const p = P();
  for (const k of META) {
    const el = $<HTMLInputElement>(`m_${k}`);
    el.value = String(p[k] ?? "");
  }
  const sel = $<HTMLSelectElement>("panelSel");
  sel.innerHTML = doc.panels.map((q, i) => `<option value="${i}">${escapeHTML(q.name || `Panel ${i + 1}`)}</option>`).join("");
  sel.value = String(active);
  $<HTMLButtonElement>("btnDel").disabled = doc.panels.length <= 1;
}

function bindMeta() {
  for (const k of META) {
    const el = $<HTMLInputElement>(`m_${k}`);
    el.addEventListener("input", () => {
      const p = P() as unknown as Record<string, unknown>;
      if (k === "mainAmps" || k === "spaces") {
        const n = Math.round(Number(el.value));
        if (!(n > 0)) return;
        p[k] = k === "spaces" ? Math.min(84, n) : n;
      } else p[k] = el.value;
      if (k === "name") renderMeta();
      if (k === "spaces" || k === "numbering" || k === "system") refreshLegs();
      changed();
    });
  }
}

// ---------------------------------------------------------------- grid

const FIELDS = ["slot", "amps", "poles", "tandem", "name", "prot", "note", "verify"] as const;
type Field = (typeof FIELDS)[number];

function escapeHTML(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function rowHTML(c: Circuit, i: number): string {
  const n = i + 1;
  const protOpts = PROTECTIONS.map((x) => `<option value="${x}"${x === c.prot ? " selected" : ""}>${PROT_LABEL[x]}</option>`).join("");
  const poleOpts = [1, 2, 3].map((x) => `<option${x === c.poles ? " selected" : ""}>${x}</option>`).join("");
  return `<tr data-i="${i}">
<td class="legc" data-leg></td>
<td><input data-f="slot" value="${escapeHTML(c.slot)}" aria-label="Row ${n} slot" class="w-slot" inputmode="numeric" autocomplete="off"></td>
<td><input data-f="amps" value="${escapeHTML(c.amps)}" aria-label="Row ${n} amps" class="w-amps" autocomplete="off"></td>
<td><select data-f="poles" aria-label="Row ${n} poles">${poleOpts}</select></td>
<td class="cb"><input type="checkbox" data-f="tandem"${c.tandem ? " checked" : ""} aria-label="Row ${n} tandem"></td>
<td><input data-f="name" value="${escapeHTML(c.name)}" aria-label="Row ${n} circuit name" class="w-name" autocomplete="off"></td>
<td><select data-f="prot" aria-label="Row ${n} protection">${protOpts}</select></td>
<td><input data-f="note" value="${escapeHTML(c.note)}" aria-label="Row ${n} note" class="w-note" autocomplete="off"></td>
<td class="cb"><input type="checkbox" data-f="verify"${c.verify ? " checked" : ""} aria-label="Row ${n} needs verification"></td>
<td><button type="button" class="x" data-del aria-label="Delete row ${n}" title="Delete row">×</button></td>
</tr>`;
}

function renderGrid(focus?: { i: number; f: Field }) {
  const p = P();
  $("gridBody").innerHTML = p.circuits.map(rowHTML).join("");
  refreshLegs();
  if (focus) focusCell(focus.i, focus.f);
}

function focusCell(i: number, f: Field) {
  const el = document.querySelector<HTMLElement>(`#gridBody tr[data-i="${i}"] [data-f="${f}"]`);
  el?.focus();
  if (el instanceof HTMLInputElement && el.type !== "checkbox") el.select();
}

/** Leg column + per-row finding markers; cheap, so it runs on every edit without rebuilding inputs. */
function refreshLegs() {
  const p = P();
  const findings = validate(p);
  const byRow = new Map<number, { level: string; msgs: string[] }>();
  const rank = { error: 3, warn: 2, info: 1 } as Record<string, number>;
  for (const f of findings) {
    if (f.circuit == null) continue;
    const cur = byRow.get(f.circuit) ?? { level: "info", msgs: [] };
    if (rank[f.level] > rank[cur.level] || !cur.msgs.length) cur.level = rank[f.level] >= rank[cur.level] ? f.level : cur.level;
    cur.msgs.push(f.msg);
    byRow.set(f.circuit, cur);
  }
  document.querySelectorAll<HTMLTableRowElement>("#gridBody tr").forEach((tr) => {
    const i = Number(tr.dataset.i);
    const c = p.circuits[i];
    if (!c) return;
    const legs = occupiedSlots(p, c).map((s) => legOfSlot(p, s) ?? "–");
    const td = tr.querySelector<HTMLElement>("[data-leg]")!;
    td.textContent = legs.join("") || "–";
    td.className = `legc leg${legs[0] ?? ""}`;
    const f = byRow.get(i);
    tr.classList.remove("r-error", "r-warn", "r-info");
    if (f) tr.classList.add(`r-${f.level}`);
    tr.title = f ? f.msgs.join("\n") : "";
  });
  const counts = { error: 0, warn: 0, info: 0 };
  findings.forEach((f) => counts[f.level]++);
  $("findSummary").innerHTML = `<b class=f-error>${counts.error}</b> errors · <b class=f-warn>${counts.warn}</b> warnings · <b class=f-info>${counts.info}</b> notes <span class=hint>(hover a row; full list under “loading + checks”; not code advice)</span>`;
}

function nextFreeSlot(p: Panel): string {
  const used = new Set(p.circuits.flatMap((c) => occupiedSlots(p, c)));
  const last = p.circuits.length ? Math.max(0, ...p.circuits.map((c) => Math.max(0, ...occupiedSlots(p, c)))) : 0;
  for (let s = last + 1; s <= p.spaces; s++) if (!used.has(s)) return String(s);
  for (let s = 1; s <= p.spaces; s++) if (!used.has(s)) return String(s);
  return "";
}

function addRow(focusField: Field = "slot") {
  const p = P();
  p.circuits.push(blankCircuit(nextFreeSlot(p)));
  renderGrid({ i: p.circuits.length - 1, f: focusField });
  changed();
}

function bindGrid() {
  const body = $("gridBody");
  const onEdit = (e: Event) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const f = el.dataset.f as Field | undefined;
    const tr = el.closest("tr");
    if (!f || !tr) return;
    const c = P().circuits[Number(tr.dataset.i)] as unknown as Record<string, unknown>;
    if (el instanceof HTMLInputElement && el.type === "checkbox") c[f] = el.checked;
    else if (f === "poles") c[f] = Number(el.value) as Poles;
    else if (f === "prot") c[f] = el.value as Protection;
    else c[f] = el.value;
    refreshLegs();
    changed();
  };
  body.addEventListener("input", onEdit);
  body.addEventListener("change", onEdit);
  body.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("[data-del]");
    if (!b) return;
    const i = Number(b.closest("tr")!.dataset.i);
    const removed = P().circuits.splice(i, 1)[0];
    renderGrid({ i: Math.min(i, P().circuits.length - 1), f: "slot" });
    changed();
    status(`deleted row ${removed.slot} ${removed.name}`);
  });
  body.addEventListener("keydown", (e) => {
    const el = e.target as HTMLElement;
    const f = el.dataset.f as Field | undefined;
    const tr = el.closest("tr");
    if (!f || !tr) return;
    const i = Number(tr.dataset.i);
    const n = P().circuits.length;
    const isSelect = el instanceof HTMLSelectElement;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !isSelect && !e.altKey) {
      e.preventDefault();
      const j = i + (e.key === "ArrowDown" ? 1 : -1);
      if (j >= 0 && j < n) focusCell(j, f);
    } else if (e.key === "Enter" && !isSelect) {
      e.preventDefault();
      if (i + 1 < n) focusCell(i + 1, f); else addRow(f);
    }
  });
  $("btnAdd").addEventListener("click", () => addRow());
  $("btnSort").addEventListener("click", () => {
    P().circuits = sortedCircuits(P()).map((x) => x.c);
    renderGrid();
    changed();
  });
  $("btnFill").addEventListener("click", () => {
    const p = P();
    const used = new Set(p.circuits.flatMap((c) => occupiedSlots(p, c)));
    let k = 0;
    for (let s = 1; s <= p.spaces; s++) if (!used.has(s)) { p.circuits.push(blankCircuit(String(s))); k++; }
    p.circuits = sortedCircuits(p).map((x) => x.c);
    renderGrid();
    changed();
    status(`added ${k} empty rows`);
  });
  $("btnClear").addEventListener("click", () => {
    const p = P();
    const before = p.circuits.length;
    p.circuits = p.circuits.filter((c) => c.name.trim() || c.amps.trim() || c.note.trim());
    renderGrid();
    changed();
    status(`pruned ${before - p.circuits.length} blank rows`);
  });
}

// ---------------------------------------------------------------- outputs

let renderQueued = false;
function changed() {
  save();
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderOutput(); });
}

function cardDims(): { w: number; h: number; page: "letter" | "a4" } {
  if (ui.cardSize === "custom") return { w: ui.cardW, h: ui.cardH, page: ui.cardW > 7.6 || ui.cardH > 10.1 ? "a4" : "letter" };
  const s = CARD_SIZES.find((x) => x.key === ui.cardSize) ?? CARD_SIZES[0];
  return s;
}

function setPageStyle(css: string) { $("pagestyle").textContent = css; }

function renderOutput() {
  const prev = $("preview");
  for (const v of ["card", "labels", "load"] as View[]) {
    const t = $(`tab-${v}`);
    t.setAttribute("aria-selected", String(ui.view === v));
    t.tabIndex = ui.view === v ? 0 : -1;
    $(`opts-${v}`).hidden = ui.view !== v;
  }
  prev.setAttribute("aria-labelledby", `tab-${ui.view}`);
  prev.dataset.view = ui.view;
  if (ui.view === "card") {
    const d = cardDims();
    setPageStyle(`@page { size: ${d.page === "a4" ? "A4" : "letter"}; margin: 0.4in; }`);
    const ps = ui.all ? doc.panels : [P()];
    prev.innerHTML = ps.map((p) => renderCard(p, { w: d.w, h: d.h, showNotes: ui.notes, showTally: ui.tally })).join("");
    fitCards(prev);
  } else if (ui.view === "labels") {
    setPageStyle(`@page { size: ${ui.lbl.page === "a4" ? "A4" : "letter"}; margin: 0; }`);
    prev.innerHTML = renderLabels(P(), { ...ui.lbl, startAt: ui.startAt, spares: ui.spares, panelName: ui.lblPanel });
  } else {
    setPageStyle(`@page { size: letter; margin: 0.5in; }`);
    prev.innerHTML = renderLoading(doc.panels, active, validate(P()));
  }
}

/** Give every slot row the same height (so 2-pole rowspans don't distort the grid) and shrink
 *  the font until the directory fits its card. Sizes are in CSS px = 1/96 in, same on paper. */
function fitCards(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".card").forEach((card) => {
    const tw = card.querySelector<HTMLElement>(".tw")!;
    const table = tw.querySelector<HTMLTableElement>("table")!;
    const trs = [...table.tBodies[0].rows];
    let fs = parseFloat(card.style.getPropertyValue("--fs")) || 9;
    for (let k = 0; k < 14; k++) {
      const h = Math.floor((tw.clientHeight / trs.length) * 100) / 100;
      trs.forEach((tr) => (tr.style.height = `${h}px`));
      if (table.offsetHeight <= tw.clientHeight + 1 || fs <= 5) break;
      fs = Math.max(5, fs * 0.92);
      card.style.setProperty("--fs", `${fs.toFixed(2)}pt`);
    }
  });
}

function renderOptions() {
  $<HTMLSelectElement>("o_cardSize").value = ui.cardSize;
  const d = cardDims();
  $<HTMLInputElement>("o_cardW").value = String(d.w);
  $<HTMLInputElement>("o_cardH").value = String(d.h);
  $<HTMLInputElement>("o_notes").checked = ui.notes;
  $<HTMLInputElement>("o_tally").checked = ui.tally;
  $<HTMLInputElement>("o_all").checked = ui.all;
  $<HTMLSelectElement>("o_lblPreset").value = LABEL_PRESETS.some((x) => x.key === ui.lbl.key) ? ui.lbl.key : "custom";
  $<HTMLInputElement>("o_startAt").value = String(ui.startAt);
  $<HTMLInputElement>("o_spares").checked = ui.spares;
  $<HTMLInputElement>("o_lblPanel").checked = ui.lblPanel;
  for (const k of ["cols", "rows", "w", "h", "top", "left", "hgap", "vgap"] as const) $<HTMLInputElement>(`g_${k}`).value = String(ui.lbl[k]);
  $("g_unit").textContent = ui.lbl.unit;
}

function bindOutputs() {
  $<HTMLSelectElement>("o_cardSize").innerHTML = CARD_SIZES.map((s) => `<option value="${s.key}">${s.label}</option>`).join("") + `<option value="custom">custom</option>`;
  $<HTMLSelectElement>("o_lblPreset").innerHTML = LABEL_PRESETS.map((s) => `<option value="${s.key}">${s.label}</option>`).join("") + `<option value="custom">custom (edit geometry)</option>`;
  const tabs = ["card", "labels", "load"] as View[];
  for (const v of tabs) {
    const t = $(`tab-${v}`);
    t.addEventListener("click", () => { ui.view = v; renderOutput(); save(); });
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const j = (tabs.indexOf(v) + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
      ui.view = tabs[j]; renderOutput(); save(); $(`tab-${tabs[j]}`).focus();
    });
  }
  const on = (id: string, fn: (el: HTMLInputElement) => void) => $<HTMLInputElement>(id).addEventListener("input", (e) => { fn(e.target as HTMLInputElement); changed(); });
  on("o_cardSize", (el) => { ui.cardSize = el.value; renderOptions(); });
  on("o_cardW", (el) => { const n = Number(el.value); if (n >= 2) { ui.cardW = n; ui.cardH = cardDims().h; ui.cardSize = "custom"; $<HTMLSelectElement>("o_cardSize").value = "custom"; } });
  on("o_cardH", (el) => { const n = Number(el.value); if (n >= 2) { ui.cardW = cardDims().w; ui.cardH = n; ui.cardSize = "custom"; $<HTMLSelectElement>("o_cardSize").value = "custom"; } });
  on("o_notes", (el) => (ui.notes = el.checked));
  on("o_tally", (el) => (ui.tally = el.checked));
  on("o_all", (el) => (ui.all = el.checked));
  on("o_lblPreset", (el) => { const pr = LABEL_PRESETS.find((x) => x.key === el.value); if (pr) ui.lbl = { ...pr }; else ui.lbl.key = "custom"; renderOptions(); });
  on("o_startAt", (el) => (ui.startAt = Math.max(1, Math.round(Number(el.value)) || 1)));
  on("o_spares", (el) => (ui.spares = el.checked));
  on("o_lblPanel", (el) => (ui.lblPanel = el.checked));
  for (const k of ["cols", "rows", "w", "h", "top", "left", "hgap", "vgap"] as const)
    on(`g_${k}`, (el) => {
      const n = Number(el.value);
      if (!Number.isFinite(n) || n < 0) return;
      ui.lbl = { ...ui.lbl, [k]: k === "cols" || k === "rows" ? Math.max(1, Math.round(n)) : n, key: "custom" };
      $<HTMLSelectElement>("o_lblPreset").value = "custom";
    });
}

// ---------------------------------------------------------------- toolbar

function download(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "panels";

function setDoc(d: Doc, idx = 0) {
  doc = d.panels.length ? d : { v: 1, panels: [blankPanel()] };
  active = Math.min(idx, doc.panels.length - 1);
  renderAll();
  save();
}

function renderAll() {
  renderMeta();
  renderGrid();
  renderOptions();
  renderOutput();
}

function bindToolbar() {
  $<HTMLSelectElement>("panelSel").addEventListener("change", (e) => {
    active = Number((e.target as HTMLSelectElement).value);
    renderAll();
    save();
  });
  $("btnNew").addEventListener("click", () => {
    doc.panels.push(blankPanel(`Panel ${doc.panels.length + 1}`));
    active = doc.panels.length - 1;
    renderAll(); save();
    $("m_name").focus();
  });
  $("btnDup").addEventListener("click", () => {
    const c = JSON.parse(JSON.stringify(P())) as Panel;
    c.id = newId();
    c.name = `${c.name} (copy)`;
    doc.panels.splice(active + 1, 0, c);
    active++;
    renderAll(); save();
  });
  $("btnDel").addEventListener("click", () => {
    if (doc.panels.length <= 1) return;
    if (!confirm(`Delete panel “${P().name}” and its ${P().circuits.length} circuits?`)) return;
    doc.panels.splice(active, 1);
    active = Math.max(0, active - 1);
    renderAll(); save();
  });
  const ex = $<HTMLSelectElement>("exSel");
  ex.innerHTML += Object.entries(EXAMPLES).map(([k, v]) => `<option value="${k}">${escapeHTML(v.label)}</option>`).join("");
  ex.addEventListener("change", () => {
    const k = ex.value;
    ex.value = "";
    if (!k) return;
    const hasData = doc.panels.some((p) => p.circuits.some((c) => c.name || c.amps));
    if (hasData && !confirm("Replace your current panels with the example? (Export first if you want to keep them.)")) return;
    setDoc(exampleDoc(k));
    status(`loaded example: ${EXAMPLES[k].label}`);
  });
  $<HTMLInputElement>("fileIn").addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    try {
      const text = await f.text();
      if (/^\s*[{[]/.test(text)) {
        const d = normalizeDoc(JSON.parse(text));
        if (!d.panels.length) throw new Error("no panels in JSON");
        if (confirm(`Replace all panels with ${d.panels.length} from ${f.name}? (Cancel appends them instead.)`)) setDoc(d);
        else { doc.panels.push(...d.panels); setDoc(doc, doc.panels.length - d.panels.length); }
      } else {
        const imp = fromCSV(text);
        const n = imp.reduce((t, x) => t + x.circuits.length, 0);
        const idx = mergeImport(doc, active, imp);
        setDoc(doc, idx);
        status(`imported ${n} circuits from ${f.name}`);
      }
    } catch (err) {
      status(`import failed: ${(err as Error).message}`);
    }
  });
  $("btnCSV").addEventListener("click", () => download(`${slug(doc.panels.length > 1 ? "panels" : P().name)}.csv`, toCSV(doc.panels), "text/csv"));
  $("btnJSON").addEventListener("click", () => download(`${slug(doc.panels.length > 1 ? "panels" : P().name)}.json`, JSON.stringify(doc, null, 1), "application/json"));
  $("btnShare").addEventListener("click", async () => {
    const code = await encodeDoc(doc);
    const url = `${location.origin}${location.pathname}#d=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      status(`share link copied (${url.length} chars; the data is in the link itself)`);
    } catch {
      prompt("Copy this link:", url);
    }
  });
  $("btnPrint").addEventListener("click", () => window.print());
}

// ---------------------------------------------------------------- boot

async function boot() {
  bindMeta();
  bindGrid();
  bindOutputs();
  bindToolbar();
  const h = new URLSearchParams(location.hash.slice(1));
  const stored = readStored();
  let incoming: Doc | null = null;
  if (h.get("d")) {
    try { incoming = await decodeDoc(h.get("d")!); status(`loaded ${incoming.panels.length} panel(s) from share link`); }
    catch { status("couldn't read that share link"); }
  } else if (h.get("ex")) incoming = exampleDoc(h.get("ex")!);
  const storedHasData = !!stored && stored.doc.panels.some((p) => p.circuits.some((c) => c.name || c.amps));
  if (incoming && incoming.panels.length) {
    // Never clobber work saved in this browser: shared/example panels are appended to it.
    if (storedHasData) {
      doc = stored!.doc;
      const key = (p: Panel) => JSON.stringify({ ...p, id: "" });
      const have = new Map(doc.panels.map((p, i) => [key(p), i]));
      const fresh = incoming.panels.filter((p) => !have.has(key(p)));
      active = fresh.length ? doc.panels.length : have.get(key(incoming.panels[0])) ?? 0;
      doc.panels.push(...fresh);
    }
    else { doc = incoming; active = 0; }
  } else if (stored) { doc = stored.doc; active = stored.active; }
  else { doc = exampleDoc("house"); active = 0; }
  if (h.get("view") && ["card", "labels", "load"].includes(h.get("view")!)) ui.view = h.get("view") as View;
  if (h.get("size")) ui.cardSize = h.get("size")!;
  if (h.get("panel")) active = Math.min(doc.panels.length - 1, (incoming && storedHasData ? active : 0) + Math.max(0, Number(h.get("panel")) || 0));
  if (h.has("d") || h.has("ex")) history.replaceState(null, "", location.pathname + location.search);
  renderAll();
  saveNow();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js").catch(() => {});
}

boot();

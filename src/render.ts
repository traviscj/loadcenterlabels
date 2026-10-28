// HTML renderers for the three outputs: door card, breaker label sheet, loading summary.
// Pure string builders (escaped), so they're testable without a DOM.
import {
  type Circuit, type Finding, type Panel, PROT_LABEL, PROT_TITLE, isUncertain, legOfRow, legsFor,
  occupiedSlots, parseAmps, position, rowsPerColumn, slotAt, sortedCircuits, summarize, imbalance,
} from "./model";

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmtA = (n: number) => (Math.round(n * 10) / 10).toString();

// ---------------------------------------------------------------- door card

export interface CardSize { key: string; label: string; w: number; h: number; page: "letter" | "a4" }
export const CARD_SIZES: CardSize[] = [
  { key: "letter", label: "Full Letter (7.5 × 10 in)", w: 7.5, h: 10, page: "letter" },
  { key: "half", label: "Half Letter (5.5 × 8.5 in)", w: 5.5, h: 8.5, page: "letter" },
  { key: "narrow", label: "Narrow door (4 × 10 in)", w: 4, h: 10, page: "letter" },
  { key: "short", label: "Short/wide (7.5 × 5 in)", w: 7.5, h: 5, page: "letter" },
  { key: "a4", label: "Full A4 (190 × 277 mm)", w: 7.48, h: 10.9, page: "a4" },
  { key: "a5", label: "A5 (138 × 200 mm)", w: 5.43, h: 7.87, page: "a4" },
];

export interface CardOpts { w: number; h: number; showNotes: boolean; showTally: boolean }

interface CellEntry { c: Circuit; i: number; span: number; pole: number; ofPoles: number }

/** Map each slot to the breakers that start there, plus which slots are covered by a rowspan. */
function layout(p: Panel) {
  const starts = new Map<number, CellEntry[]>();
  const covered = new Set<number>();
  const coveredBy = new Map<number, number>();
  const claims = new Map<number, number>();
  for (const { c } of sortedCircuits(p)) for (const s of occupiedSlots(p, c)) claims.set(s, (claims.get(s) ?? 0) + 1);
  for (const { c, i } of sortedCircuits(p)) {
    const occ = occupiedSlots(p, c);
    const pos = occ.map((s) => position(p, s));
    if (!occ.length || pos.some((x) => !x)) continue;
    const contiguous = pos.every((x, k) => k === 0 || (x!.col === pos[0]!.col && x!.row === pos[0]!.row + k));
    const clean = contiguous && occ.slice(1).every((s) => (claims.get(s) ?? 0) === (c.tandem ? 2 : 1) && (!covered.has(s) || (c.tandem && coveredBy.get(s) === occ[0])));
    if (c.poles > 1 && clean) {
      const list = starts.get(occ[0]) ?? [];
      list.push({ c, i, span: c.poles, pole: 0, ofPoles: c.poles });
      starts.set(occ[0], list);
      occ.slice(1).forEach((s) => { covered.add(s); coveredBy.set(s, occ[0]); });
    } else {
      occ.forEach((s, k) => {
        const list = starts.get(s) ?? [];
        list.push({ c, i, span: 1, pole: k, ofPoles: c.poles });
        starts.set(s, list);
      });
    }
  }
  return { starts, covered };
}

function ampsHTML(c: Circuit): string {
  const a = parseAmps(c.amps);
  if (!c.amps) return "";
  return a.uncertain ? `<i class=unc title="unverified rating">${esc(c.amps)}</i>` : esc(c.amps);
}

function chips(c: Circuit): string {
  let s = "";
  if (c.prot) s += ` <span class="chip p-${c.prot}" title="${esc(PROT_TITLE[c.prot])}">${esc(PROT_LABEL[c.prot])}</span>`;
  if (c.tandem) s += ` <span class="chip tdm" title="tandem / twin breaker">T</span>`;
  if (isUncertain(c)) s += ` <span class="chip vfy">verify</span>`;
  return s;
}

export function renderCard(p: Panel, o: CardOpts): string {
  const R = rowsPerColumn(p);
  const sm = summarize(p);
  const { starts, covered } = layout(p);
  const notes: string[] = [];
  const noteIdx = new Map<number, number>();
  for (const { c, i } of sortedCircuits(p)) if (c.note.trim() && o.showNotes) { notes.push(`<b>${esc(occupiedSlots(p, c).join("-") || c.slot)}</b> ${esc(c.note.trim())}`); noteIdx.set(i, notes.length); }

  const cell = (slot: number, side: 0 | 1): string => {
    if (covered.has(slot)) return "";
    const ents = starts.get(slot) ?? [];
    const numCls = side === 0 ? "n nl" : "n nr";
    if (!ents.length) {
      const parts = [`<td class="${numCls}">${slot}</td>`, `<td class="a"></td>`, `<td class="c empty"></td>`];
      return (side === 0 ? parts.reverse() : parts).join("");
    }
    const span = Math.max(...ents.map((e) => e.span));
    const rs = span > 1 ? ` rowspan=${span}` : "";
    const multi = ents.some((e) => e.ofPoles > 1);
    const unc = ents.some((e) => isUncertain(e.c));
    const cls = `${multi ? " mp" : ""}${unc ? " uncr" : ""}`;
    const tand = ents.length > 1;
    const nums = span > 1 ? occupiedSlots(p, ents[0].c).join("<br>") : tand ? ents.map((_, k) => `${slot}${"ab"[k] ?? ""}`).join("<br>") : String(slot);
    const amps = ents.map((e) => ampsHTML(e.c)).join("<br>");
    const names = ents.map((e) => {
      const n = noteIdx.get(e.i);
      const pole = e.span === 1 && e.ofPoles > 1 ? ` <span class=pole>(pole ${e.pole + 1}/${e.ofPoles})</span>` : "";
      return `<span class=nm>${esc(e.c.name) || "<span class=empty>(unlabeled)</span>"}</span>${n ? `<sup>${n}</sup>` : ""}${pole}${chips(e.c)}`;
    }).join(tand ? "<br>" : "");
    const parts = [`<td class="${numCls}${cls}"${rs}>${nums}</td>`, `<td class="a${cls}"${rs}>${amps}</td>`, `<td class="c${cls}${tand ? " tand" : ""}"${rs}>${names}</td>`];
    return (side === 0 ? parts.reverse() : parts).join("");
  };

  const trs: string[] = [];
  for (let r = 1; r <= R; r++) {
    const leg = legOfRow(p, r);
    const l = slotAt(p, 0, r), rr = slotAt(p, 1, r);
    trs.push(`<tr>${cell(l, 0)}<td class="leg leg${leg}">${leg}</td>${rr <= p.spaces ? cell(rr, 1) : `<td class="n nr"></td><td class=a></td><td class="c empty"></td>`}</tr>`);
  }

  // Font size heuristic: rows share whatever height is left after header/footer.
  const footLines = (o.showTally ? 1.6 : 0) + (notes.length ? Math.ceil(notes.join(" · ").length / (o.w * 22)) * 0.85 : 0) + (p.notes ? 0.9 : 0);
  const avail = o.h - 0.75 - footLines * 0.13;
  const rowIn = avail / R;
  const fs = Math.max(5.5, Math.min(12, rowIn * 72 * 0.46, (o.w * 72) / 40));

  const legs = legsFor(p).map((l) => `leg ${l} <b>${fmtA(sm.legs[l])}</b>`).join(" · ");
  const tally = o.showTally
    ? `<div class=tally>${legs} A connected vs <b>${p.mainAmps}</b> A main (${sm.worstRatio.toFixed(2)}× worst leg) · ${sm.n1} 1-pole · ${sm.n2} 2-pole${sm.n3 ? ` · ${sm.n3} 3-pole` : ""} · <b>${sm.free}</b> free space${sm.free === 1 ? "" : "s"}${sm.uncertain ? ` · <span class="chip vfy">verify</span> ${sm.uncertain} open` : ""}</div>`
    : "";
  const sys = p.system === "three" ? "3φ" : "120/240 V";
  const meta = [p.brand, `${p.mainAmps} A`, sys, `${p.spaces} spaces`].filter(Boolean).map(esc).join(" · ");
  const when = [p.date && `surveyed ${esc(p.date)}`, p.verifiedBy && `by ${esc(p.verifiedBy)}`].filter(Boolean).join(" ");
  return `<section class="card" style="width:${o.w}in;height:${o.h}in;--fs:${fs.toFixed(2)}pt">
<header><b class=pname>${esc(p.name || "Panel")}</b><span class=pmeta>${meta}</span></header>
<div class=sub><span>${esc(p.location)}</span><span>${when}</span></div>
<div class=legend>shaded = multi-pole · centre strip = bus leg · <i class=unc>15?</i> <span class="chip vfy">verify</span> = unconfirmed reading</div>
<div class=tw><table class=dir><colgroup><col class=cc><col class=ca><col class=cn><col class=cl><col class=cn><col class=ca><col class=cc></colgroup><tbody>${trs.join("")}</tbody></table></div>
<footer>${tally}${notes.length ? `<div class=notes>${notes.map((n, k) => `<sup>${k + 1}</sup>${n}`).join(" · ")}</div>` : ""}${p.notes ? `<div class=pnotes>${esc(p.notes)}</div>` : ""}<div class=colophon>pencil corrections here, then update the source · tcj.io/loadcenterlabels</div></footer>
</section>`;
}

// ---------------------------------------------------------------- label sheet

export interface LabelPreset {
  key: string; label: string; page: "letter" | "a4"; unit: "in" | "mm";
  cols: number; rows: number; w: number; h: number; top: number; left: number; hgap: number; vgap: number;
}
export const LABEL_PRESETS: LabelPreset[] = [
  { key: "5167", label: "Avery 5167/8167 (80/sheet, 1¾ × ½ in)", page: "letter", unit: "in", cols: 4, rows: 20, w: 1.75, h: 0.5, top: 0.5, left: 0.3, hgap: 0.3, vgap: 0 },
  { key: "5160", label: "Avery 5160/8160 (30/sheet, 2⅝ × 1 in)", page: "letter", unit: "in", cols: 3, rows: 10, w: 2.625, h: 1, top: 0.5, left: 0.1875, hgap: 0.125, vgap: 0 },
  { key: "5195", label: "Avery 5195 (60/sheet, 1¾ × ⅔ in)", page: "letter", unit: "in", cols: 4, rows: 15, w: 1.75, h: 0.6667, top: 0.5, left: 0.28, hgap: 0.3, vgap: 0.1667 },
  { key: "L7651", label: "Avery L7651 A4 (65/sheet, 38.1 × 21.2 mm)", page: "a4", unit: "mm", cols: 5, rows: 13, w: 38.1, h: 21.2, top: 10.7, left: 4.7, hgap: 2.5, vgap: 0 },
  { key: "L7656", label: "Avery L7656 A4 (84/sheet, 46 × 11.1 mm)", page: "a4", unit: "mm", cols: 4, rows: 21, w: 46, h: 11.1, top: 6.4, left: 5.9, hgap: 5.9, vgap: 2.5 },
];

export interface LabelOpts extends LabelPreset { startAt: number; spares: boolean; panelName: boolean }

export function labelItems(p: Panel, spares: boolean): { slot: string; c: Circuit | null }[] {
  const items: { slot: string; c: Circuit | null; k: number }[] = [];
  const used = new Set<number>();
  const seen = new Map<number, number>();
  for (const { c } of sortedCircuits(p)) {
    const occ = occupiedSlots(p, c);
    occ.forEach((s) => used.add(s));
    if (!occ.length) continue;
    const n = (seen.get(occ[0]) ?? 0) + 1;
    seen.set(occ[0], n);
    const tandemSuffix = c.tandem ? "ab"[n - 1] ?? "" : "";
    items.push({ slot: occ.join("-") + tandemSuffix, c, k: occ[0] });
  }
  if (spares) for (let s = 1; s <= p.spaces; s++) if (!used.has(s)) items.push({ slot: String(s), c: null, k: s });
  return items.sort((a, b) => a.k - b.k).map(({ slot, c }) => ({ slot, c }));
}

export function renderLabels(p: Panel, o: LabelOpts): string {
  const per = o.cols * o.rows;
  const blanks = Math.max(0, Math.min(per - 1, Math.floor(o.startAt) - 1));
  const items: ({ slot: string; c: Circuit | null } | null)[] = [...Array(blanks).fill(null), ...labelItems(p, o.spares)];
  const pages: string[] = [];
  const u = o.unit;
  const fs = Math.max(5, Math.min(12, (o.unit === "mm" ? o.h / 25.4 : o.h) * 72 * 0.3));
  for (let k = 0; k < Math.max(1, items.length); k += per) {
    const cells = items.slice(k, k + per).map((it) => {
      if (!it) return `<div class="lbl skip"></div>`;
      const { slot, c } = it;
      if (!c) return `<div class="lbl spare"><b class=ls>${esc(slot)}</b><span class=lt>SPARE</span></div>`;
      const unc = isUncertain(c);
      return `<div class="lbl${c.poles > 1 ? " mp" : ""}${unc ? " uncr" : ""}"><b class="ls${slot.length > 3 ? " long" : ""}">${esc(slot)}</b><span class=lt><span class=ln>${esc(c.name)}</span><span class=la>${ampsHTML(c)}${c.amps ? " A" : ""}${c.poles > 1 ? ` ${c.poles}P` : ""}${chips(c)}${o.panelName ? ` <span class=lp>${esc(p.name)}</span>` : ""}</span></span></div>`;
    });
    pages.push(`<section class="sheet page-${o.page}" style="--fs:${fs.toFixed(2)}pt;padding:${o.top}${u} 0 0 ${o.left}${u};grid-template-columns:repeat(${o.cols},${o.w}${u});grid-auto-rows:${o.h}${u};column-gap:${o.hgap}${u};row-gap:${o.vgap}${u}">${cells.join("")}</section>`);
  }
  return pages.join("");
}

// ---------------------------------------------------------------- loading summary

function bar(v: number, main: number, cls: string): string {
  const max = 3 * main;
  const pct = main > 0 ? Math.min(100, (v / max) * 100) : 0;
  return `<span class="bar" role="img" aria-label="${fmtA(v)} A, ${(v / main).toFixed(2)} times main"><span class="fill ${cls}" style="width:${pct.toFixed(1)}%"></span><span class=t1></span><span class=t2></span></span>`;
}

export function renderLoading(panels: Panel[], active: number, findings: Finding[]): string {
  const anyThree = panels.some((p) => p.system === "three");
  const legCols = anyThree ? ["A", "B", "C"] as const : ["A", "B"] as const;
  const rows = panels.map((p, k) => {
    const s = summarize(p);
    const m = p.mainAmps;
    const legsTd = legCols.map((l) => `<td class=num>${legsFor(p).includes(l) ? fmtA(s.legs[l]) : "—"}</td>`).join("");
    const worst = s.worstRatio;
    const cls = worst > 3 ? "hot" : worst > 2 ? "warm" : "ok";
    return `<tr${k === active ? " class=act" : ""}><td><b>${esc(p.name)}</b></td><td class=num>${m}</td>${legsTd}<td class=barcell>${bar(s.worstAmps, m, cls)} <span class="num ${cls}">${worst.toFixed(2)}×</span></td><td class=num>${(imbalance(p, s) * 100).toFixed(0)}%</td><td class=num>${fmtA(s.left)} / ${fmtA(s.right)}</td><td class=num>${s.n1} / ${s.n2}${s.n3 ? ` / ${s.n3}` : ""}</td><td class=num>${fmtA(s.a240)}</td><td class=num>${s.free}/${p.spaces}</td><td class=num>${s.uncertain || ""}</td></tr>`;
  }).join("");

  const p = panels[active];
  const s = p ? summarize(p) : null;
  const legBars = p && s ? legsFor(p).map((l) => `<div class=legrow><span class="legchip leg${l}">${l}</span>${bar(s.legs[l], p.mainAmps, "ok")}<span class=num>${fmtA(s.legs[l])} A · ${(s.legs[l] / p.mainAmps).toFixed(2)}×</span></div>`).join("") : "";

  const order = { error: 0, warn: 1, info: 2 } as const;
  const fs = [...findings].sort((a, b) => order[a.level] - order[b.level]);
  const counts = { error: 0, warn: 0, info: 0 };
  fs.forEach((f) => counts[f.level]++);
  const flist = fs.map((f) => `<li class="f-${f.level}"><span class=lvl>${f.level}</span> ${esc(f.msg)}</li>`).join("");

  return `<div class=loading>
<h3>Connected load, all panels</h3>
<table class=lt><thead><tr><th>Panel</th><th>Main A</th>${legCols.map((l) => `<th>Leg ${l}</th>`).join("")}<th>Worst leg vs main <span class=hint>(tick = 1×, bar end = 3×)</span></th><th title="(max leg − min leg) / max leg">Imbal.</th><th>Left / right</th><th>1P / 2P${anyThree ? " / 3P" : ""}</th><th>240 V A</th><th>Free</th><th>?</th></tr></thead><tbody>${rows}</tbody></table>
${p ? `<h3>${esc(p.name)}: per leg</h3><div class=legbars>${legBars}</div>` : ""}
<p class=caveat><b>What this is:</b> the sum of breaker handle ratings on each bus leg — the most each leg could draw if every circuit ran at its trip rating at once. A multi-pole breaker counts its full rating on each leg it lands on; rows alternate legs down the panel (${p?.system === "three" ? "A, B, C" : "A, B, A, B"}). Connected capacity of 2–3× the main is normal. <b>It is not a demand load:</b> an NEC 220.82-style calculation (3 VA/ft² lighting + small-appliance circuits + nameplates, first 10 kVA at 100 % and the rest at 40 %, plus the larger of heat or cool) usually lands far below this. Use it for leg balance, free spaces and spotting where a new 240 V load fits.</p>
<h3>Soft checks <span class=hint>— ${counts.error} errors · ${counts.warn} warnings · ${counts.info} notes · not code advice; ask a licensed electrician</span></h3>
<ul class=findings>${flist || "<li class=f-info>No findings.</li>"}</ul>
</div>`;
}

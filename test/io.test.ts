import { describe, expect, it } from "vitest";
import { fromCSV, mergeImport, parseCSV, toCSV } from "../src/csv";
import { decodeDoc, encodeDoc } from "../src/share";
import { exampleDoc } from "../src/examples";
import { type Doc, blankPanel, normalizeDoc } from "../src/model";
import { renderCard, renderLabels, renderLoading, LABEL_PRESETS } from "../src/render";

const strip = (d: Doc) => d.panels.map(({ id: _id, ...rest }) => rest);

describe("CSV", () => {
  it("parses quotes, escaped quotes, CRLF and embedded newlines", () => {
    expect(parseCSV('a,b\r\n"x, y","he said ""hi"""\n"multi\nline",z')).toEqual([["a", "b"], ["x, y", 'he said "hi"'], ["multi\nline", "z"]]);
  });
  it("round-trips every example panel", () => {
    const d = exampleDoc("house");
    const back = fromCSV(toCSV(d.panels));
    expect(back.map((x) => x.name)).toEqual(d.panels.map((p) => p.name));
    back.forEach((imp, k) => expect(imp.circuits).toEqual(d.panels[k].circuits));
  });
  it("survives awkward strings", () => {
    const d = exampleDoc("main");
    d.panels[0].circuits[0].name = 'Kitchen, "island", east\nline 2';
    d.panels[0].circuits[0].note = "  leading space";
    const back = fromCSV(toCSV(d.panels));
    expect(back[0].circuits[0].name).toBe(d.panels[0].circuits[0].name);
    expect(back[0].circuits[0].note).toBe("leading space"); // trimmed on import by design
  });
  it("accepts home-made headers and infers poles from '1-3'", () => {
    const imp = fromCSV("Breaker,Amps,Description,Type\n1-3,100,Sub feed,\n5,15?,Bedroom,CAFCI\n");
    expect(imp).toHaveLength(1);
    expect(imp[0].name).toBeNull();
    expect(imp[0].circuits[0]).toMatchObject({ slot: "1-3", poles: 2, amps: "100", name: "Sub feed" });
    expect(imp[0].circuits[1]).toMatchObject({ prot: "AFCI", amps: "15?" });
  });
  it("merge: unnamed import replaces active panel and grows spaces", () => {
    const d: Doc = { v: 1, panels: [{ ...blankPanel("A"), spaces: 4 }] };
    mergeImport(d, 0, fromCSV("slot,amps\n1,20\n9,15\n"));
    expect(d.panels[0].circuits).toHaveLength(2);
    expect(d.panels[0].spaces).toBeGreaterThanOrEqual(9);
  });
  it("rejects CSV without a slot column", () => {
    expect(() => fromCSV("foo,bar\n1,2\n")).toThrow(/slot/);
  });
});

describe("share hash", () => {
  it("round-trips the full example document", async () => {
    const d = exampleDoc("house");
    const code = await encodeDoc(d);
    expect(code[0]).toBe("z");
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(strip(await decodeDoc(code))).toEqual(strip(d));
  });
  it("compresses meaningfully", async () => {
    const d = exampleDoc("house");
    const code = await encodeDoc(d);
    expect(code.length).toBeLessThan(JSON.stringify(d).length / 2);
  });
  it("round-trips unicode and flags", async () => {
    const d = normalizeDoc({ panels: [{ name: "Ünïcode ⚡ panel", circuits: [{ slot: "3", amps: "20?", poles: 1, name: "Café – “quotes”", tandem: true, verify: true, prot: "GFCI-R" }] }] });
    expect(strip(await decodeDoc(await encodeDoc(d)))).toEqual(strip(d));
  });
  it("rejects garbage", async () => {
    await expect(decodeDoc("q123")).rejects.toThrow();
  });
});

describe("renderers", () => {
  const d = exampleDoc("house");
  it("door card escapes HTML and shows verify chips", () => {
    const p = structuredClone(d.panels[0]);
    p.circuits[0].name = "<script>x</script>";
    const html = renderCard(p, { w: 7.5, h: 10, showNotes: true, showTally: true });
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('<i class=unc title="unverified rating">15?</i>');
    expect((html.match(/chip vfy/g) ?? []).length).toBeGreaterThan(2);
    expect((html.match(/<tr>/g) ?? []).length).toBe(20);
  });
  it("label sheet honours start offset and paging", () => {
    const p = d.panels[0];
    const html = renderLabels(p, { ...LABEL_PRESETS[1], startAt: 29, spares: false, panelName: false });
    expect((html.match(/class="sheet/g) ?? []).length).toBe(2);
    expect((html.match(/lbl skip/g) ?? []).length).toBe(28);
  });
  it("loading view lists every panel", () => {
    const html = renderLoading(d.panels, 0, []);
    for (const p of d.panels) expect(html).toContain(p.name);
    expect(html).toContain("not code advice");
  });
});

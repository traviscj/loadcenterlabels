import { describe, expect, it } from "vitest";
import {
  type Circuit, type Panel, blankCircuit, blankPanel, isUncertain, legOfSlot, occupiedSlots, parseAmps,
  parseProtection, parseSlot, position, slotAt, summarize, validate,
} from "../src/model";
import { exampleDoc, EXAMPLES } from "../src/examples";

const c = (slot: string, amps: string, poles: 1 | 2 | 3 = 1, extra: Partial<Circuit> = {}): Circuit => ({ ...blankCircuit(slot), amps, poles, name: `c${slot}`, ...extra });
const panel = (over: Partial<Panel> = {}, circuits: Circuit[] = []): Panel => ({ ...blankPanel("T"), mainAmps: 100, spaces: 20, ...over, circuits });

describe("leg assignment", () => {
  it("odd-even: rows alternate A/B, both columns share a row's leg", () => {
    const p = panel();
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((s) => legOfSlot(p, s))).toEqual(["A", "A", "B", "B", "A", "A", "B", "B"]);
  });
  it("sequential: down the left column then the right, legs by row", () => {
    const p = panel({ numbering: "sequential", spaces: 12 });
    expect(position(p, 1)).toEqual({ col: 0, row: 1 });
    expect(position(p, 7)).toEqual({ col: 1, row: 1 });
    expect([1, 2, 3, 7, 8].map((s) => legOfSlot(p, s))).toEqual(["A", "B", "A", "A", "B"]);
    expect(slotAt(p, 1, 2)).toBe(8);
  });
  it("three-phase cycles A/B/C", () => {
    const p = panel({ system: "three", spaces: 42 });
    expect([1, 3, 5, 7, 2, 4, 6].map((s) => legOfSlot(p, s))).toEqual(["A", "B", "C", "A", "A", "B", "C"]);
  });
  it("2-pole stacks in its column and lands on both legs", () => {
    const p = panel({}, [c("5", "30", 2)]);
    expect(occupiedSlots(p, p.circuits[0])).toEqual([5, 7]);
    const s = summarize(p);
    expect(s.legs.A).toBe(30);
    expect(s.legs.B).toBe(30);
    expect(s.left).toBe(60);
    expect(s.n2).toBe(1);
    expect(s.a240).toBe(30);
    expect(s.free).toBe(18);
  });
  it("sequential 2-pole uses adjacent slot numbers", () => {
    const p = panel({ numbering: "sequential", spaces: 12 }, [c("5", "20", 2)]);
    expect(occupiedSlots(p, p.circuits[0])).toEqual([5, 6]);
    expect(validate(p).filter((f) => f.level === "error")).toEqual([]);
  });
  it("explicit pole list overrides stacking", () => {
    expect(parseSlot("7-9")).toEqual([7, 9]);
    expect(parseSlot("7 / 9")).toEqual([7, 9]);
    expect(parseSlot("x")).toBeNull();
    const p = panel({}, [c("7-9", "20", 2)]);
    expect(occupiedSlots(p, p.circuits[0])).toEqual([7, 9]);
  });
  it("totals: 1-pole on one leg, left/right columns", () => {
    const p = panel({}, [c("1", "20"), c("2", "15"), c("3", "20")]);
    const s = summarize(p);
    expect(s.legs).toMatchObject({ A: 35, B: 20 });
    expect([s.left, s.right]).toEqual([40, 15]);
    expect(s.worstLeg).toBe("A");
    expect(s.worstRatio).toBeCloseTo(0.35);
  });
});

describe("validation", () => {
  const codes = (p: Panel) => validate(p).map((f) => f.code);
  it("flags a 2-pole whose explicit slots share a leg", () => {
    const p = panel({}, [c("1-2", "30", 2)]); // same row → same leg
    expect(codes(p)).toContain("same-leg");
  });
  it("flags overlaps but allows a tandem pair", () => {
    expect(codes(panel({}, [c("1", "20"), c("1", "15")]))).toContain("overlap");
    expect(codes(panel({}, [c("1", "20", 1, { tandem: true }), c("1", "15", 1, { tandem: true })]))).not.toContain("overlap");
    expect(codes(panel({}, [c("1", "30", 2), c("3", "15")]))).toContain("overlap");
  });
  it("quad: two tandem 2-poles in the same slots are fine", () => {
    const p = panel({}, [c("5", "20", 2, { tandem: true }), c("5", "30", 2, { tandem: true })]);
    expect(codes(p)).not.toContain("overlap");
  });
  it("out of range and bad slot", () => {
    expect(codes(panel({ spaces: 20 }, [c("19", "30", 2)]))).toContain("range");
    expect(codes(panel({}, [c("abc", "20")]))).toContain("slot");
  });
  it("sequential 2-pole across the column break", () => {
    expect(codes(panel({ numbering: "sequential", spaces: 12 }, [c("6", "20", 2)]))).toContain("span-col");
  });
  it("over-subscription is a warning above 3x the main", () => {
    const many = Array.from({ length: 10 }, (_, k) => c(String(1 + 4 * k), "50", 2));
    const p = panel({ mainAmps: 100, spaces: 40 }, many);
    expect(codes(p)).toContain("oversub");
  });
  it("soft GFCI/AFCI hints only when unprotected", () => {
    expect(codes(panel({}, [{ ...c("1", "20"), name: "Kitchen counter" }]))).toContain("gfci-typical");
    expect(codes(panel({}, [{ ...c("1", "20"), name: "Kitchen counter", prot: "DFCI" }]))).not.toContain("gfci-typical");
    expect(codes(panel({}, [{ ...c("1", "15"), name: "Bedroom 2" }]))).toContain("afci-typical");
    expect(codes(panel({}, [{ ...c("1", "15"), name: "Bath", prot: "GFCI-R" }]))).not.toContain("gfci-typical");
    expect(codes(panel({}, [{ ...c("1", "15"), name: "Basement lights" }]))).not.toContain("gfci-typical");
    expect(codes(panel({}, [{ ...c("1", "20"), name: "Bath – hall", prot: "GFCI-R" }]))).not.toContain("afci-typical");
  });
  it("3-pole in split-phase", () => {
    expect(codes(panel({ spaces: 20 }, [c("1", "30", 3)]))).toContain("3p-split");
  });
});

describe("uncertainty", () => {
  it("parses '15?' as 15, uncertain", () => {
    expect(parseAmps("15?")).toEqual({ value: 15, uncertain: true });
    expect(parseAmps("20")).toEqual({ value: 20, uncertain: false });
    expect(parseAmps("")).toEqual({ value: null, uncertain: false });
  });
  it("flags verify via amps, flag, or note", () => {
    expect(isUncertain(c("1", "15?"))).toBe(true);
    expect(isUncertain(c("1", "15", 1, { verify: true }))).toBe(true);
    expect(isUncertain(c("1", "15", 1, { note: "also stickered RADON – verify" }))).toBe(true);
    expect(isUncertain(c("1", "15"))).toBe(false);
  });
  it("uncertain ratings still count in the totals", () => {
    expect(summarize(panel({}, [c("1", "15?")])).legs.A).toBe(15);
  });
});

describe("protection parser", () => {
  it("maps common spellings", () => {
    expect(parseProtection("CAFCI")).toBe("AFCI");
    expect(parseProtection("AFCI/GFCI")).toBe("DFCI");
    expect(parseProtection("gfci outlet")).toBe("GFCI-R");
    expect(parseProtection("GFI")).toBe("GFCI");
    expect(parseProtection("")).toBe("");
  });
});

describe("examples", () => {
  it("every example validates with no errors", () => {
    for (const k of Object.keys(EXAMPLES)) {
      for (const p of exampleDoc(k).panels) {
        const errs = validate(p).filter((f) => f.level === "error");
        expect(errs, `${k}/${p.name}: ${errs.map((e) => e.msg).join("; ")}`).toEqual([]);
      }
    }
  });
});

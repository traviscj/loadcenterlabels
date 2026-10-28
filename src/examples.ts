// Fictional example panels. Plausible circuits, no real house.
import { type Circuit, type Doc, type Panel, type Poles, type Protection, normalizeDoc } from "./model";

type Row = [slot: string, amps: string, poles: Poles, name: string, prot?: Protection, note?: string, flags?: string];

function rows(list: Row[]): Circuit[] {
  return list.map(([slot, amps, poles, name, prot = "", note = "", flags = ""]) => ({
    slot, amps, poles, name, prot, note, tandem: flags.includes("t"), verify: flags.includes("v"),
  }));
}

function panel(p: Omit<Panel, "id" | "circuits">, list: Row[]): Panel {
  return { id: "", ...p, circuits: rows(list) };
}

export const EXAMPLES: Record<string, { label: string; panels: () => Panel[] }> = {
  house: {
    label: "House: 200 A main + 100 A garage sub + generator transfer panel",
    panels: () => [mainPanel(), garageSub(), genPanel()],
  },
  main: { label: "200 A, 40-space main panel", panels: () => [mainPanel()] },
  sub: { label: "100 A, 24-space garage subpanel", panels: () => [garageSub()] },
  gen: { label: "Generator transfer panel (sequential numbering)", panels: () => [genPanel()] },
  rtu: { label: "208Y/120 3-phase small-office panel", panels: () => [threePhase()] },
};

export function exampleDoc(key: string): Doc {
  const ex = EXAMPLES[key] ?? EXAMPLES.house;
  return normalizeDoc({ panels: ex.panels() });
}

function mainPanel(): Panel {
  return panel({
    name: "Main Panel", location: "Basement, north wall by the water meter", brand: "Homeline-style 40-space, 200 A main breaker",
    mainAmps: 200, spaces: 40, numbering: "odd-even", system: "split", date: "2026-10-12", verifiedBy: "A. Example",
    notes: "Example data. Circuit tracing done with a plug-in tracer; rows marked verify still need a second look.",
  }, [
    ["1", "100", 2, "Garage subpanel feed", "", "2 AWG Al SER to garage"],
    ["2", "50", 2, "Range", "", ""],
    ["5", "30", 2, "Dryer", "", ""],
    ["6", "40", 2, "A/C condenser", "", "nameplate MOCP 40 A"],
    ["9", "30", 2, "Water heater", "", ""],
    ["10", "50", 2, "Generator transfer panel feed", "", "via 50 A interlock"],
    ["13", "20", 1, "Kitchen counter – left", "DFCI"],
    ["14", "20", 1, "Kitchen counter – island", "DFCI"],
    ["15", "20", 1, "Dishwasher + disposal", "DFCI"],
    ["16", "20", 1, "Microwave (OTR)", "AFCI"],
    ["17", "20", 1, "Refrigerator", "", "dedicated"],
    ["18", "15", 1, "Kitchen + dining lights", "AFCI"],
    ["19", "20", 1, "Laundry receptacles", "DFCI"],
    ["20", "15", 1, "Bedroom 1 (primary)", "AFCI"],
    ["21", "20", 1, "Bath – primary", "GFCI"],
    ["22", "15", 1, "Bedroom 2", "AFCI"],
    ["23", "20", 1, "Bath – hall", "GFCI-R", "GFCI receptacle at vanity"],
    ["24", "15", 1, "Bedroom 3 + hall smoke detectors", "AFCI"],
    ["25", "15", 1, "Living room", "AFCI"],
    ["26", "15?", 1, "Family room", "", "handle label worn – verify rating", "v"],
    ["27", "15", 1, "Furnace", "", "service switch at unit"],
    ["28", "20", 1, "Basement receptacles", "", "no GFCI found – check"],
    ["29", "15", 1, "Basement lights"],
    ["30", "20", 1, "Garage door opener + ceiling"],
    ["31", "20", 1, "Exterior receptacles", "GFCI-R"],
    ["32", "15", 1, "Exterior lights + doorbell xfmr", "", "", "v"],
    ["33", "15", 1, "Office", "AFCI"],
    ["34", "20", 1, "Sump pump", "", "on generator panel too? verify", "v"],
    ["35", "15", 1, "Attic fan", "", "", "t"],
    ["35", "15", 1, "Radon fan", "", "", "t"],
  ]);
}

function garageSub(): Panel {
  return panel({
    name: "Garage Subpanel", location: "Detached garage, east wall", brand: "Main-lug 24-space, fed from Main Panel 1-3",
    mainAmps: 100, spaces: 24, numbering: "odd-even", system: "split", date: "2026-10-12", verifiedBy: "A. Example",
    notes: "Separate grounding electrode at garage; neutrals isolated.",
  }, [
    ["1", "50", 2, "EV charger (48 A hardwired)", "", "EVSE has its own CCID"],
    ["2", "30", 2, "Air compressor"],
    ["5", "20", 2, "Mini-split heat pump"],
    ["6", "20", 1, "Workbench receptacles", "GFCI"],
    ["9", "20", 1, "Garage receptacles – west"],
    ["8", "15", 1, "Garage lights"],
    ["11", "20", 1, "Chest freezer", "", "on non-GFCI on purpose? check local code"],
    ["10", "20?", 1, "Outdoor receptacle – side yard", "GFCI", "", "v"],
    ["13", "15", 1, "Exterior floods"],
  ]);
}

function genPanel(): Panel {
  return panel({
    name: "Generator Panel", location: "Basement, next to Main Panel", brand: "10-circuit manual transfer switch, 50 A inlet",
    mainAmps: 50, spaces: 12, numbering: "sequential", system: "split", date: "2026-10-12", verifiedBy: "",
    notes: "Portable 7.5 kW (≈31 A/leg at 240 V). Run loads selectively.",
  }, [
    ["1", "15", 1, "Furnace blower"],
    ["2", "20", 1, "Refrigerator"],
    ["3", "20", 1, "Sump pump"],
    ["4", "15", 1, "Network + security"],
    ["5", "20", 2, "Well pump", "", "240 V, 1 hp"],
    ["7", "15", 1, "Kitchen lights", "AFCI"],
    ["8", "20", 1, "Chest freezer"],
    ["9", "15", 1, "Living room lights", "AFCI"],
    ["10", "15", 1, "Bedroom lights", "AFCI"],
  ]);
}

function threePhase(): Panel {
  return panel({
    name: "Panel LP-1", location: "Suite 200 electrical closet", brand: "42-circuit 208Y/120 3φ, 225 A main",
    mainAmps: 225, spaces: 42, numbering: "odd-even", system: "three", date: "2026-10-01", verifiedBy: "",
    notes: "Example 3-phase panel: rows cycle A/B/C.",
  }, [
    ["1", "60", 3, "RTU-1 rooftop unit"],
    ["2", "40", 3, "RTU-2 rooftop unit"],
    ["7", "20", 1, "Receptacles – open office N"],
    ["8", "20", 1, "Receptacles – open office S"],
    ["9", "20", 1, "Receptacles – conference"],
    ["10", "20", 1, "Break room counter", "GFCI"],
    ["11", "20", 1, "Break room refrigerator"],
    ["12", "20", 1, "Microwave"],
    ["13", "20", 1, "Lighting – north", "", "LED troffers"],
    ["14", "20", 1, "Lighting – south"],
    ["15", "30", 2, "Electric water heater", "", "208 V"],
    ["16", "20", 1, "Server closet UPS", "", "dedicated"],
    ["18", "20?", 1, "Exit / emergency lights", "", "lock-on device missing – verify", "v"],
  ]);
}

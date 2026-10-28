// Share links: JSON -> deflate-raw (CompressionStream) -> base64url in the URL hash.
// Nothing leaves the browser; the hash fragment is never sent to the server.
import { type Doc, normalizeDoc } from "./model";

/** Compact on-the-wire form: drop empty/default fields to keep links short. */
function pack(doc: Doc): unknown {
  return {
    v: 1,
    p: doc.panels.map((p) => ({
      n: p.name, l: p.location || undefined, b: p.brand || undefined, m: p.mainAmps, s: p.spaces,
      nb: p.numbering === "sequential" ? "q" : undefined, sy: p.system === "three" ? 3 : undefined,
      d: p.date || undefined, vb: p.verifiedBy || undefined, x: p.notes || undefined,
      c: p.circuits.map((c) => [c.slot, c.amps, c.poles, c.name, c.prot, c.note, (c.tandem ? 1 : 0) | (c.verify ? 2 : 0)]),
    })),
  };
}

type Packed = { v: number; p: Array<Record<string, unknown> & { c: unknown[][] }> };

function unpack(o: Packed): Doc {
  return normalizeDoc({
    panels: (o.p ?? []).map((p) => ({
      name: p.n, location: p.l, brand: p.b, mainAmps: p.m, spaces: p.s,
      numbering: p.nb === "q" ? "sequential" : "odd-even", system: p.sy === 3 ? "three" : "split",
      date: p.d, verifiedBy: p.vb, notes: p.x,
      circuits: (p.c ?? []).map((r) => ({
        slot: r[0], amps: r[1], poles: r[2], name: r[3], prot: r[4], note: r[5],
        tandem: !!(Number(r[6]) & 1), verify: !!(Number(r[6]) & 2),
      })),
    })),
  });
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(t as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeDoc(doc: Doc): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(pack(doc)));
  if (typeof CompressionStream === "undefined") return "j" + b64url(json);
  return "z" + b64url(await pipe(json, new CompressionStream("deflate-raw")));
}

export async function decodeDoc(s: string): Promise<Doc> {
  const kind = s[0], body = s.slice(1);
  let bytes = unb64url(body);
  if (kind === "z") bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
  else if (kind !== "j") throw new Error("unknown share-link format");
  return unpack(JSON.parse(new TextDecoder().decode(bytes)) as Packed);
}

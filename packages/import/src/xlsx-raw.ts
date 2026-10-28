// Raw look at one worksheet of an .xlsx, for the one fact exceljs drops: a formula whose saved
// result is the empty string (=IF(paid,"",due)). Excel stores it as t="str" with an empty <v>;
// exceljs reads that as "no saved result", the same as a formula never calculated, which the
// dry-run refuses (L-0085 P0-02 D2). This module finds those cells so they read as empty
// (L-0116 P0-02 FP1).
//
// It FAILS CLOSED: any problem (ZIP64, encryption, an unknown compression method, a sheet it
// cannot find) gives an empty set, and every formula without a saved result stays refused.
// Only a cell positively seen as t="str" with an empty <v> becomes "". No dependency is added:
// the ZIP container is read with node:zlib.

import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

const MAX_ENTRY = 256 * 1024 * 1024;   // refuse to inflate anything larger (zip bomb guard)

type Entry = { name: string; method: number; compressed: number; size: number; offset: number; flags: number };

function entries(buf: Buffer): Map<string, Entry> {
  // End of central directory: the last "PK\x05\x06" in the final 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("no end of central directory");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new Error("zip64 is not supported");
  const out = new Map<string, Entry>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory entry");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (compressed === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new Error("zip64 is not supported");
    out.set(name.replace(/^\//, ""), { name, method, compressed, size, offset, flags });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function read(buf: Buffer, all: Map<string, Entry>, name: string): string {
  const e = all.get(name);
  if (!e) throw new Error(`no ${name}`);
  if (e.flags & 1) throw new Error("encrypted entry");
  if (e.size > MAX_ENTRY) throw new Error("entry too large");
  if (buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error("bad local header");
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const data = buf.subarray(start, start + e.compressed);
  if (e.method === 0) return data.toString("utf8");
  if (e.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY }).toString("utf8");
  throw new Error(`compression method ${e.method} is not supported`);
}

const unescapeXml = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

// Attributes of one start tag, by name (never by position).
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = unescapeXml(m[3] ?? m[4] ?? "");
  return out;
}

// Resolve a relationship target ("worksheets/sheet1.xml", "/xl/worksheets/sheet1.xml",
// "../xl/worksheets/sheet1.xml") against the xl/ folder.
function resolveTarget(target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : `xl/${target}`).split("/");
  const out: string[] = [];
  for (const s of parts) { if (s === "..") out.pop(); else if (s !== "." && s !== "") out.push(s); }
  return out.join("/");
}

// Addresses ("D2") of the formula cells in `sheetName` whose saved result is an empty string.
export async function emptyStringFormulaCells(path: string, sheetName: string): Promise<Set<string>> {
  try {
    const buf = await readFile(path);
    const all = entries(buf);
    const workbook = read(buf, all, "xl/workbook.xml");
    const sheet = [...workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)].map((m) => attrs(m[0])).find((a) => a.name === sheetName);
    const rid = sheet && Object.entries(sheet).find(([k]) => k === "r:id" || k.endsWith(":id"))?.[1];
    if (!rid) return new Set();
    const rels = read(buf, all, "xl/_rels/workbook.xml.rels");
    const rel = [...rels.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)].map((m) => attrs(m[0])).find((a) => a.Id === rid);
    if (!rel?.Target || rel.TargetMode === "External") return new Set();
    const xml = read(buf, all, resolveTarget(rel.Target));

    const found = new Set<string>();
    // Each cell: <c ...>...</c> (a self-closing <c/> has no formula).
    for (const m of xml.matchAll(/<(?:\w+:)?c\b([^>]*?)(\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const body = m[3];
      if (body === undefined) continue;
      const a = attrs(m[1]);
      if (a.t !== "str" || !a.r) continue;
      if (!/<(?:\w+:)?f\b/.test(body)) continue;                                  // a formula, shared or not
      if (!/<(?:\w+:)?v\b[^>]*?(?:\/>|>\s*<\/(?:\w+:)?v>)/.test(body)) continue;   // an empty saved value, present
      found.add(a.r.toUpperCase());
    }
    return found;
  } catch {
    return new Set();   // fail closed: those formulas stay "no saved result"
  }
}

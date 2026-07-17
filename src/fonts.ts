import { AFM } from "./afm.js";
import type { FontFamily, FontSlot, ParsedFont } from "./types.js";

const UNI2WIN: Record<number, number> = {};
for (let c = 32; c < 127; c++) UNI2WIN[c] = c;
for (let c = 160; c < 256; c++) UNI2WIN[c] = c;
Object.assign(UNI2WIN, {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84,
  0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f, 0x25e6: 0xb0,
});

export function parseTrueType(input: ArrayBuffer | Uint8Array): ParsedFont {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables: Record<string, { off: number; len: number }> = {};
  for (let i = 0; i < dv.getUint16(4); i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
    tables[tag] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) };
  }
  for (const tag of ["glyf", "head", "cmap", "hmtx", "hhea", "maxp"])
    if (!tables[tag]) throw new Error(`Unsupported font: missing ${tag} TrueType table`);
  const at = (tag: string) => tables[tag]!.off;
  const head = at("head");
  const upem = dv.getUint16(head + 18);
  const bbox: [number, number, number, number] = [36, 38, 40, 42].map(o => dv.getInt16(head + o)) as typeof bbox;
  const hhea = at("hhea");
  const ascent = dv.getInt16(hhea + 4), descent = dv.getInt16(hhea + 6);
  const numH = dv.getUint16(hhea + 34), numGlyphs = dv.getUint16(at("maxp") + 4);
  const advances = new Uint16Array(numGlyphs);
  let last = 0;
  for (let g = 0; g < numGlyphs; g++) {
    if (g < numH) last = dv.getUint16(at("hmtx") + g * 4);
    advances[g] = last;
  }
  const cm = at("cmap"), count = dv.getUint16(cm + 2);
  let best = 0, score = -1;
  for (let i = 0; i < count; i++) {
    const platform = dv.getUint16(cm + 4 + i * 8), encoding = dv.getUint16(cm + 6 + i * 8);
    const candidate = cm + dv.getUint32(cm + 8 + i * 8), format = dv.getUint16(candidate);
    const s = platform === 3 && encoding === 10 && format === 12 ? 4
      : platform === 3 && encoding === 1 && format === 4 ? 3
      : platform === 0 && format === 12 ? 2 : platform === 0 && format === 4 ? 1 : 0;
    if (s > score) { score = s; best = candidate; }
  }
  const cmap = new Map<number, number>(), format = dv.getUint16(best);
  if (format === 4) {
    const segX2 = dv.getUint16(best + 6), ends = best + 14;
    const starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = dv.getUint16(ends + s * 2), start = dv.getUint16(starts + s * 2);
      const delta = dv.getInt16(deltas + s * 2), ro = dv.getUint16(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph = ro === 0 ? (c + delta) & 0xffff : dv.getUint16(ranges + s * 2 + ro + (c - start) * 2);
        if (ro && glyph) glyph = (glyph + delta) & 0xffff;
        if (glyph) cmap.set(c, glyph);
      }
    }
  } else if (format === 12) {
    for (let i = 0; i < dv.getUint32(best + 12); i++) {
      const o = best + 16 + i * 12, start = dv.getUint32(o), end = dv.getUint32(o + 4), first = dv.getUint32(o + 8);
      for (let c = start; c <= end; c++) cmap.set(c, first + c - start);
    }
  } else throw new Error(`Unsupported cmap format ${format}`);

  let family = "Custom", subfamily = "Regular", postscriptName = "CustomFont";
  if (tables.name) {
    const nm = at("name"), stringOffset = nm + dv.getUint16(nm + 4);
    const found = new Set<number>();
    for (let i = 0; i < dv.getUint16(nm + 2); i++) {
      const o = nm + 6 + i * 12, platform = dv.getUint16(o), id = dv.getUint16(o + 6);
      if (![1, 2, 6].includes(id) || found.has(id)) continue;
      const len = dv.getUint16(o + 8), offset = stringOffset + dv.getUint16(o + 10);
      let value = "";
      if (platform === 0 || platform === 3) for (let k = 0; k < len; k += 2) value += String.fromCharCode(dv.getUint16(offset + k));
      else for (let k = 0; k < len; k++) value += String.fromCharCode(dv.getUint8(offset + k));
      if (id === 1) family = value; else if (id === 2) subfamily = value; else postscriptName = value;
      found.add(id);
    }
  }
  let capHeight = Math.round(ascent * 0.7), italicAngle = 0;
  if (tables["OS/2"] && tables["OS/2"]!.len >= 90) capHeight = dv.getInt16(at("OS/2") + 88) || capHeight;
  if (tables.post) italicAngle = dv.getInt32(at("post") + 4) / 65536;
  return { bytes, upem, numGlyphs, cmap, advances, bbox, ascent, descent, capHeight, italicAngle, family, subfamily, postscriptName };
}

export function fontSlot(subfamily: string): FontSlot {
  const s = subfamily.toLowerCase(), bold = /(bold|semibold|demibold)/.test(s), italic = /(italic|oblique)/.test(s);
  return bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "regular";
}

export function createFontFamily(inputs: Partial<Record<FontSlot, ArrayBuffer | Uint8Array>>, id?: string): FontFamily {
  const styles: FontFamily["styles"] = {};
  for (const [slot, bytes] of Object.entries(inputs) as [FontSlot, ArrayBuffer | Uint8Array][]) styles[slot] = parseTrueType(bytes);
  const first = Object.values(styles)[0];
  if (!first) throw new Error("A font family needs at least one style");
  const safeId = id ?? `font-${first.family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return { id: safeId, label: first.family, cssFamily: `mkd-${safeId}`, styles };
}

export function pickFont(family: FontFamily, bold = false, italic = false): ParsedFont {
  const wanted: FontSlot = bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "regular";
  return family.styles[wanted] ?? family.styles.regular ?? Object.values(family.styles)[0]!;
}

export class FontRegistry {
  private readonly families = new Map<string, FontFamily>();
  constructor(families: FontFamily[] = []) { for (const family of families) this.add(family); }
  add(family: FontFamily): this { this.families.set(family.id, family); return this; }
  get(id: string): FontFamily | undefined { return this.families.get(id); }
  values(): FontFamily[] { return [...this.families.values()]; }
  familyForCodePoint(preferredId: string, codePoint: number, bold = false, italic = false): string {
    const preferred = this.get(preferredId);
    if (!preferred || pickFont(preferred, bold, italic).cmap.has(codePoint)) return preferredId;
    for (const family of this.families.values()) {
      if (family.supplemental && pickFont(family, bold, italic).cmap.has(codePoint)) return family.id;
    }
    throw new Error(`No embedded glyph for U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`);
  }
  measure(text: string, size: number, options: { family?: string; bold?: boolean; italic?: boolean; mono?: boolean; tracking?: number } = {}): number {
    let units = 0;
    const family = options.family ? this.get(options.family) : undefined;
    if (family) {
      const font = pickFont(family, options.bold, options.italic);
      for (const char of text) {
        const codePoint = char.codePointAt(0)!;
        const glyph = font.cmap.get(codePoint);
        if (glyph == null) throw new Error(`Font ${family.id} has no glyph for U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`);
        units += font.advances[glyph] ?? font.upem * 0.5;
      }
      units = units * size / font.upem;
    } else {
      const name = afmName(options.bold, options.italic, options.mono, options.family);
      const widths = AFM[name]!;
      for (const char of text) units += widths[UNI2WIN[char.codePointAt(0)!] ?? 63] ?? widths[63]!;
      units = units * size / 1000;
    }
    return units + (options.tracking ?? 0) * text.length;
  }
}

export function afmName(bold = false, italic = false, mono = false, family?: string): string {
  if (mono) return "Courier";
  if (family === "serif") return bold && italic ? "Times-BoldItalic" : bold ? "Times-Bold" : italic ? "Times-Italic" : "Times-Roman";
  return bold && italic ? "Helvetica-BoldOblique" : bold ? "Helvetica-Bold" : italic ? "Helvetica-Oblique" : "Helvetica";
}

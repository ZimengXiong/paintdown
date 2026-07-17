import { deflate } from "pako";
import { FontRegistry, pickFont } from "./fonts.js";
import type { DrawItem, ImageAsset, LayoutResult, ParsedFont, TextItem } from "./types.js";

type ObjectBody = string | (string | Uint8Array)[];
const encoder = new TextEncoder();
const number = (value: number) => `${Math.round(value * 100) / 100}`;
const unicodeHex = (codePoint: number) => {
  if (codePoint <= 0xffff) return codePoint.toString(16).padStart(4, "0");
  const value = codePoint - 0x10000;
  const high = 0xd800 + (value >> 10), low = 0xdc00 + (value & 0x3ff);
  return `${high.toString(16).padStart(4, "0")}${low.toString(16).padStart(4, "0")}`;
};

function escapePdf(value: string): string {
  let result = "";
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code > 0x7f) {
      for (const byte of encoder.encode(char)) result += `\\${byte.toString(8).padStart(3, "0")}`;
    } else if (code === 40 || code === 41 || code === 92) result += `\\${String.fromCharCode(code)}`;
    else if (code < 32 || code > 126) result += `\\${code.toString(8).padStart(3, "0")}`;
    else result += String.fromCharCode(code);
  }
  return result;
}

function splitPixels(asset: ImageAsset): { color: Uint8Array; alpha?: Uint8Array; colorSpace: string } {
  if (!asset.pixels || !asset.channels) throw new Error(`Decoded pixels missing for ${asset.source}`);
  const channels = asset.channels, hasAlpha = channels === 2 || channels === 4, colorChannels = channels <= 2 ? 1 : 3;
  if (!hasAlpha) return { color: asset.pixels, colorSpace: colorChannels === 1 ? "/DeviceGray" : "/DeviceRGB" };
  const count = asset.width * asset.height, color = new Uint8Array(count * colorChannels), alpha = new Uint8Array(count);
  for (let pixel = 0; pixel < count; pixel++) {
    for (let channel = 0; channel < colorChannels; channel++) color[pixel * colorChannels + channel] = asset.pixels[pixel * channels + channel]!;
    alpha[pixel] = asset.pixels[pixel * channels + channels - 1]!;
  }
  return { color, alpha, colorSpace: colorChannels === 1 ? "/DeviceGray" : "/DeviceRGB" };
}

export function renderPdf(layout: LayoutResult, fonts = new FontRegistry()): Uint8Array {
  const objects: ObjectBody[] = [], add = (body: ObjectBody) => (objects.push(body), objects.length);
  add(""); add("");

  const cidFonts = new Map<string, { resource: string; font: ParsedFont; used: Map<number, number> }>();
  const images = new Map<string, { resource: string; asset: ImageAsset }>();
  let fontSequence = 0, imageSequence = 0;
  const pageStreams: string[] = [], pageAnnotations: { x: number; y: number; width: number; height: number; url: string }[][] = [];

  const cidFor = (item: TextItem) => {
    const family = fonts.get(item.family)!;
    const font = pickFont(family, item.bold, item.italic), slot = Object.entries(family.styles).find(([, value]) => value === font)?.[0] ?? "regular";
    const key = `${family.id}|${slot}`;
    if (!cidFonts.has(key)) cidFonts.set(key, { resource: `T${fontSequence++}`, font, used: new Map() });
    return cidFonts.get(key)!;
  };

  for (const page of layout.pages) {
    let stream = ""; const annotations: typeof pageAnnotations[number] = [];
    for (const item of page) {
      if (item.type === "rect") stream += `${item.color.join(" ")} rg ${number(item.x)} ${number(layout.pageHeight - item.y - item.height)} ${number(item.width)} ${number(item.height)} re f\n`;
      else if (item.type === "line") stream += `${item.color.join(" ")} RG ${number(item.width)} w ${number(item.x1)} ${number(layout.pageHeight - item.y1)} m ${number(item.x2)} ${number(layout.pageHeight - item.y2)} l S\n`;
      else if (item.type === "image") {
        if (!images.has(item.asset.id)) images.set(item.asset.id, { resource: `Im${imageSequence++}`, asset: item.asset });
        const resource = images.get(item.asset.id)!.resource;
        stream += `q ${number(item.width)} 0 0 ${number(item.height)} ${number(item.x)} ${number(layout.pageHeight - item.y - item.height)} cm /${resource} Do Q\n`;
      } else {
        const baseline = layout.pageHeight - item.y - item.size * 0.86, family = fonts.get(item.family);
        if (!family) throw new Error(`PDF font ${item.family} is not embedded`);
        const cid = cidFor(item); let hex = "";
        for (const char of item.text) {
          const unicode = char.codePointAt(0)!, glyph = cid.font.cmap.get(unicode);
          if (glyph == null) throw new Error(`PDF font ${item.family} has no glyph for U+${unicode.toString(16).toUpperCase().padStart(4, "0")}`);
          cid.used.set(glyph, unicode);
          hex += glyph.toString(16).padStart(4, "0");
        }
        const operation = `/${cid.resource} ${number(item.size)} Tf ${number(item.tracking ?? 0)} Tc ${item.color.join(" ")} rg ${number(item.x)} ${number(baseline)} Td <${hex}> Tj`;
        stream += `BT ${operation} ET\n`;
        if (item.strike) {
          const width = fonts.measure(item.text, item.size, { family: item.family, bold: item.bold, italic: item.italic, mono: item.mono, tracking: item.tracking });
          stream += `${item.color.join(" ")} RG ${number(Math.max(0.5, item.size * 0.055))} w ${number(item.x)} ${number(baseline + item.size * 0.28)} m ${number(item.x + width)} ${number(baseline + item.size * 0.28)} l S\n`;
        }
        if (item.link) {
          const width = fonts.measure(item.text, item.size, { family: item.family, bold: item.bold, italic: item.italic, mono: item.mono, tracking: item.tracking });
          stream += `${item.color.join(" ")} RG 0.5 w ${number(item.x)} ${number(baseline - 1.5)} m ${number(item.x + width)} ${number(baseline - 1.5)} l S\n`;
          annotations.push({ x: item.x, y: layout.pageHeight - item.y - item.size * 1.1, width, height: item.size * 1.25, url: item.link });
        }
      }
    }
    pageStreams.push(stream); pageAnnotations.push(annotations);
  }

  let fontResources = "";
  for (const cid of cidFonts.values()) {
    const font = cid.font, scale = 1000 / font.upem, name = `MKD+${font.postscriptName.replace(/[^A-Za-z0-9.-]/g, "")}`;
    const file = add([`<< /Length ${font.bytes.length} /Length1 ${font.bytes.length} >>\nstream\n`, font.bytes, "\nendstream"]);
    const descriptor = add(`<< /Type /FontDescriptor /FontName /${name} /Flags 32 /StemV 80 /FontBBox [${font.bbox.map(v => Math.round(v * scale)).join(" ")}] /ItalicAngle ${font.italicAngle} /Ascent ${Math.round(font.ascent * scale)} /Descent ${Math.round(font.descent * scale)} /CapHeight ${Math.round(font.capHeight * scale)} /FontFile2 ${file} 0 R >>`);
    const glyphs = [...cid.used.keys()].sort((a, b) => a - b);
    const widths = glyphs.map(glyph => `${glyph} [${Math.round((font.advances[glyph] ?? font.upem * 0.5) * scale)}]`).join(" ");
    const descendant = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /CIDToGIDMap /Identity /DW 500 /W [${widths}] >>`);
    const mappings = glyphs.map(glyph => `<${glyph.toString(16).padStart(4, "0")}> <${unicodeHex(cid.used.get(glyph) ?? 0xfffd)}>`).join("\n");
    const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${glyphs.length} beginbfchar\n${mappings}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
    const unicodeMap = add(`<< /Length ${encoder.encode(cmap).length} >>\nstream\n${cmap}\nendstream`);
    const type0 = add(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${descendant} 0 R] /ToUnicode ${unicodeMap} 0 R >>`);
    fontResources += ` /${cid.resource} ${type0} 0 R`;
  }

  let imageResources = "";
  for (const { resource, asset } of images.values()) {
    let id: number;
    if (asset.format === "jpeg") {
      const colorSpace = asset.channels === 1 ? "/DeviceGray" : asset.channels === 4 ? "/DeviceCMYK" : "/DeviceRGB";
      const decode = asset.channels === 4 ? " /Decode [1 0 1 0 1 0 1 0]" : "";
      id = add([`<< /Type /XObject /Subtype /Image /Width ${asset.width} /Height ${asset.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode${decode} /Length ${asset.bytes.length} >>\nstream\n`, asset.bytes, "\nendstream"]);
    } else {
      const { color, alpha, colorSpace } = splitPixels(asset), compressed = deflate(color);
      let mask = "";
      if (alpha) { const data = deflate(alpha); const maskId = add([`<< /Type /XObject /Subtype /Image /Width ${asset.width} /Height ${asset.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`, data, "\nendstream"]); mask = ` /SMask ${maskId} 0 R`; }
      id = add([`<< /Type /XObject /Subtype /Image /Width ${asset.width} /Height ${asset.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /FlateDecode${mask} /Length ${compressed.length} >>\nstream\n`, compressed, "\nendstream"]);
    }
    imageResources += ` /${resource} ${id} 0 R`;
  }

  const pageIds: number[] = [];
  for (let page = 0; page < layout.pages.length; page++) {
    const stream = pageStreams[page]!, content = add(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}endstream`);
    const annotations = pageAnnotations[page]!.map(annotation => add(`<< /Type /Annot /Subtype /Link /Border [0 0 0] /Rect [${number(annotation.x)} ${number(annotation.y)} ${number(annotation.x + annotation.width)} ${number(annotation.y + annotation.height)}] /A << /S /URI /URI (${escapePdf(annotation.url)}) >> >>`));
    pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(layout.pageWidth)} ${number(layout.pageHeight)}] /Resources << /Font << ${fontResources} >>${imageResources ? ` /XObject <<${imageResources} >>` : ""} >> /Contents ${content} 0 R${annotations.length ? ` /Annots [${annotations.map(id => `${id} 0 R`).join(" ")}]` : ""} >>`));
  }
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] >>`;

  const chunks: Uint8Array[] = []; let position = 0; const offsets: number[] = [];
  const push = (part: string | Uint8Array) => { const bytes = typeof part === "string" ? encoder.encode(part) : part; chunks.push(bytes); position += bytes.length; };
  push("%PDF-1.4\n%âãÏÓ\n");
  objects.forEach((body, index) => { offsets[index] = position; push(`${index + 1} 0 obj\n`); for (const part of Array.isArray(body) ? body : [body]) push(part); push("\nendobj\n"); });
  const xref = position;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const output = new Uint8Array(position); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

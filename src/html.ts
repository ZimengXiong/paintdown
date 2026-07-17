import { resolveOptions } from "./config.js";
import { resolveColorEmoji } from "./color-emoji.js";
import { FontRegistry } from "./fonts.js";
import { layoutDocument } from "./layout.js";
import { loadStandardFonts } from "./standard-fonts.js";
import type { DrawItem, FontFamily, MarkdownDocument, RenderOptions, TextItem } from "./types.js";

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
function fontFaces(families: FontFamily[]): string {
  const rules: string[] = [];
  for (const family of families) {
    const emitted = new Set<object>();
    for (const [slot, font] of Object.entries(family.styles)) if (font && !emitted.has(font)) {
      emitted.add(font);
      rules.push(`@font-face{font-family:"${family.cssFamily}";src:url(data:font/ttf;base64,${base64(font.bytes)}) format("truetype");font-weight:${family.supplemental ? 400 : slot.includes("bold") ? 600 : 400};font-style:${family.supplemental ? "normal" : slot.includes("italic") ? "italic" : "normal"}}`);
    }
  }
  return rules.join("\n");
}

const rgb = (color: readonly number[]) => `rgb(${color.map(channel => Math.round(channel * 255)).join(" ")})`;

function paintedFont(item: TextItem, families: Map<string, FontFamily>): string {
  const custom = families.get(item.family);
  if (!custom) throw new Error(`HTML font ${item.family} is not embedded`);
  return custom.cssFamily;
}

function paintedItem(item: DrawItem, families: Map<string, FontFamily>, offsetY = 0): string {
  if (item.type === "text") {
    const supplemental = families.get(item.family)?.supplemental;
    const style = `left:${item.x}px;top:${item.y - offsetY}px;font-family:${paintedFont(item, families)};font-size:${item.size}px;font-weight:${!supplemental && item.bold ? 600 : 400};font-style:${!supplemental && item.italic ? "italic" : "normal"};letter-spacing:${item.tracking ?? 0}px;color:${rgb(item.color)};text-decoration:${[item.link && "underline", item.strike && "line-through"].filter(Boolean).join(" ") || "none"}`;
    const content = escape(item.text);
    return item.link ? `<a class="paintmark-text" href="${escape(item.link)}" style="${style}">${content}</a>`
      : `<span class="paintmark-text" style="${style}">${content}</span>`;
  }
  if (item.type === "rect") return `<span class="paintmark-rect" style="left:${item.x}px;top:${item.y - offsetY}px;width:${item.width}px;height:${item.height}px;background:${rgb(item.color)}"></span>`;
  if (item.type === "line") {
    const left = Math.min(item.x1, item.x2), top = Math.min(item.y1, item.y2) - offsetY;
    const width = Math.max(Math.abs(item.x2 - item.x1), item.width), height = Math.max(Math.abs(item.y2 - item.y1), item.width);
    return `<svg class="paintmark-line" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px;overflow:visible" viewBox="0 0 ${width} ${height}" aria-hidden="true"><line x1="${item.x1 - left}" y1="${item.y1 - offsetY - top}" x2="${item.x2 - left}" y2="${item.y2 - offsetY - top}" stroke="${rgb(item.color)}" stroke-width="${item.width}"/></svg>`;
  }
  const style = `left:${item.x}px;top:${item.y - offsetY}px;width:${item.width}px;height:${item.height}px`;
  if (item.asset.vectorSvg) {
    const svg = item.asset.vectorSvg.replace("<svg ", '<svg aria-hidden="true" focusable="false" ');
    return `<span class="paintmark-image paintmark-vector" style="${style}">${svg}</span>`;
  }
  return `<img class="paintmark-image" style="${style}" src="data:${item.asset.mimeType};base64,${base64(item.asset.bytes)}" alt="">`;
}

export function renderHtml(document: MarkdownDocument, partial: Partial<RenderOptions> = {}, fonts: FontFamily[] = []): string {
  document = resolveColorEmoji(document);
  let embedded = fonts, configured = partial;
  if (!embedded.length) {
    const standard = loadStandardFonts();
    embedded = [standard.body, standard.display, standard.mono, standard.emoji];
    configured = { bodyFont: standard.body.id, headingFont: standard.display.id, monoFont: standard.mono.id, ...partial };
  }
  const options = resolveOptions(configured), registry = new FontRegistry(embedded);
  const layout = layoutDocument(document.blocks, registry, options);
  const families = new Map(embedded.map(family => [family.id, family]));
  const itemTop = (item: DrawItem) => item.type === "text" || item.type === "rect" || item.type === "image"
    ? item.y : Math.min(item.y1, item.y2) - item.width / 2;
  const itemBottom = (item: DrawItem) => item.type === "text" ? item.y + item.size
    : item.type === "rect" || item.type === "image" ? item.y + item.height
    : Math.max(item.y1, item.y2) + item.width / 2;
  const isDot = (item: DrawItem) => item.type === "rect"
    && item.width <= options.fontSize * 0.2 && item.height <= options.fontSize * 0.2;
  const segments = layout.pages.map(items => {
    const content = items.filter(item => !isDot(item));
    const top = content.length ? Math.min(...content.map(itemTop)) : options.marginTop;
    const bottom = content.length ? Math.max(...content.map(itemBottom)) : top;
    const visible = items.filter(item => !isDot(item) || (itemBottom(item) >= top && itemTop(item) <= bottom));
    return { top, height: Math.max(options.fontSize, bottom - top), items: visible };
  });
  const pages = segments.map((segment, index) =>
    `<section class="paintmark-page" aria-label="Document segment ${index + 1}" style="height:${segment.height}px">${segment.items.map(item => paintedItem(item, families, segment.top)).join("")}</section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
${fontFaces(embedded)}
*{box-sizing:border-box}html,body{background:#fff}body{margin:0;padding:48px 24px;display:flex;flex-direction:column;align-items:center;gap:${Math.max(4, options.fontSize * (options.lineHeight - 1))}px}.paintmark-page{position:relative;flex:none;width:${layout.pageWidth}px;background:#fff;overflow:hidden}.paintmark-text,.paintmark-rect,.paintmark-line,.paintmark-image{position:absolute}.paintmark-text{display:block;line-height:1;white-space:pre}.paintmark-vector{display:block}.paintmark-vector svg{display:block;width:100%;height:100%;max-width:none;max-height:none}@media(max-width:${layout.pageWidth + 48}px){body{align-items:flex-start}.paintmark-page{transform-origin:top left}}
</style></head><body>${pages}</body></html>`;
}

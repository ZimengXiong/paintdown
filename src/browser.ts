import type { DrawItem, FontFamily, LayoutResult } from "./types.js";

const color = (value: readonly number[]) => `rgb(${value.map(channel => Math.round(channel * 255)).join(" ")})`;
const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

export async function registerBrowserFonts(families: FontFamily[]): Promise<void> {
  for (const family of families) for (const [slot, font] of Object.entries(family.styles)) if (font) {
    const source = font.bytes.buffer.slice(font.bytes.byteOffset, font.bytes.byteOffset + font.bytes.byteLength) as ArrayBuffer;
    const face = new FontFace(family.cssFamily, source, { weight: slot.includes("bold") ? "600" : "400", style: slot.includes("italic") ? "italic" : "normal" });
    await face.load(); document.fonts.add(face);
  }
}

function fontCss(item: Extract<DrawItem, { type: "text" }>, families: Map<string, FontFamily>): string {
  const custom = families.get(item.family), family = custom ? `"${custom.cssFamily}"`
    : item.mono ? "ui-monospace,SFMono-Regular,Consolas,monospace" : item.family === "serif" ? "Georgia,serif" : "Helvetica,Arial,sans-serif";
  return `${item.italic ? "italic " : ""}${item.bold ? "600 " : "400 "}${item.size}px/${item.size}px ${family}`;
}

export function renderPreview(container: HTMLElement, layout: LayoutResult, fontFamilies: FontFamily[] = [], maximumScale = 1.35): void {
  const families = new Map(fontFamilies.map(family => [family.id, family])), scale = Math.min(maximumScale, (container.clientWidth - 48) / layout.pageWidth);
  container.replaceChildren();
  for (const pageItems of layout.pages) {
    const wrapper = document.createElement("div"); wrapper.className = "mkd-page-wrap";
    Object.assign(wrapper.style, { width: `${layout.pageWidth * scale}px`, height: `${layout.pageHeight * scale}px` });
    const page = document.createElement("div"); page.className = "mkd-page";
    Object.assign(page.style, { position: "relative", width: `${layout.pageWidth}px`, height: `${layout.pageHeight}px`, transform: `scale(${scale})`, transformOrigin: "top left", background: "white", boxShadow: "0 2px 14px #0003" });
    for (const item of pageItems) {
      const element = document.createElement(item.type === "image" ? "img" : "div");
      element.style.position = "absolute";
      if (item.type === "text") {
        element.textContent = item.text;
        Object.assign(element.style, { left: `${item.x}px`, top: `${item.y}px`, font: fontCss(item, families), color: color(item.color), whiteSpace: "pre", letterSpacing: `${item.tracking ?? 0}px`, textDecoration: item.link ? "underline" : "none" });
      } else if (item.type === "rect") Object.assign(element.style, { left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px`, background: color(item.color) });
      else if (item.type === "line") Object.assign(element.style, { left: `${Math.min(item.x1, item.x2)}px`, top: `${Math.min(item.y1, item.y2) - item.width / 2}px`, width: `${Math.abs(item.x2 - item.x1) || item.width}px`, height: `${Math.abs(item.y2 - item.y1) || item.width}px`, background: color(item.color) });
      else {
        const image = element as HTMLImageElement; image.src = `data:${item.asset.mimeType};base64,${base64(item.asset.bytes)}`;
        Object.assign(image.style, { left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px`, objectFit: "contain" });
      }
      page.append(element);
    }
    wrapper.append(page); container.append(wrapper);
  }
}

export function downloadBytes(bytes: Uint8Array, filename: string, mimeType: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mimeType }), url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

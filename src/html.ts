import { PAGE_SIZES, resolveOptions, typeMetrics } from "./config.js";
import { highlightCodeLine } from "./highlight.js";
import { latexToText } from "./math.js";
import type { Block, FontFamily, ImageAsset, InlineRun, MarkdownDocument, RenderOptions } from "./types.js";

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const imageSource = (block: Extract<Block, { type: "image" }>) => block.asset ? `data:${block.asset.mimeType};base64,${base64(block.asset.bytes)}` : block.source;

function mathAssetHtml(asset: ImageAsset, source: string, display: boolean): string {
  const label = escape(source);
  if (asset.vectorSvg) {
    const svg = asset.vectorSvg.replace("<svg ", '<svg aria-hidden="true" focusable="false" ');
    return display ? `<div class="math-display" role="math" aria-label="${label}">${svg}</div>`
      : `<span class="math-inline" role="math" aria-label="${label}">${svg}</span>`;
  }
  const data = escape(`data:${asset.mimeType};base64,${base64(asset.bytes)}`);
  if (display) return `<div class="math-display" role="math" aria-label="${label}"><img src="${data}" alt="${label}"${asset.widthEm ? ` style="width:${asset.widthEm * 1.12}em"` : ""}></div>`;
  return `<span class="math-inline" role="math" aria-label="${label}"><img src="${data}" alt=""></span>`;
}

function runs(runs: InlineRun[]): string {
  return runs.map(run => {
    let result = escape(run.text);
    if (run.mathAsset) result = mathAssetHtml(run.mathAsset, run.mathSource ?? run.text, false);
    else if (run.math) result = `<span class="math-inline">${result}</span>`;
    if (run.code) result = `<code>${result}</code>`;
    if (run.bold) result = `<strong>${result}</strong>`;
    if (run.italic) result = `<em>${result}</em>`;
    if (run.strike) result = `<del>${result}</del>`;
    if (run.link) result = `<a href="${escape(run.link)}">${result}</a>`;
    return result;
  }).join("");
}

function blocksHtml(blocks: Block[], options: RenderOptions): string {
  return blocks.map((block, index) => {
    switch (block.type) {
      case "paragraph": return `<p>${runs(block.runs)}</p>`;
      case "heading": return `<h${block.level}>${runs(block.runs)}</h${block.level}>`;
      case "rule": return '<div class="thematic-break" role="separator" aria-label="Section break"><span>•</span><span>•</span><span>•</span></div>';
      case "code": return `<pre><code${block.lang ? ` class="language-${escape(block.lang)}"` : ""}>${block.lines.map(line => highlightCodeLine(line, block.lang).map(token => `<span class="tok-${token.token}">${escape(token.text)}</span>`).join("")).join("\n")}</code></pre>`;
      case "math": return block.asset
        ? mathAssetHtml(block.asset, block.source, true)
        : `<div class="math-display" role="math" aria-label="${escape(block.source)}">${escape(latexToText(block.source))}</div>`;
      case "quote": return `<blockquote>${blocksHtml(block.children, options)}</blockquote>`;
      case "list": return `<${block.ordered ? "ol" : "ul"}>${block.items.map(item => `<li class="depth-${item.depth}">${runs(item.runs)}</li>`).join("")}</${block.ordered ? "ol" : "ul"}>`;
      case "table": return `<table><thead><tr>${block.header.map(cell => `<th>${runs(cell)}</th>`).join("")}</tr></thead><tbody>${block.rows.map(row => `<tr>${row.map(cell => `<td>${runs(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      case "image": {
        const portrait = block.asset && block.asset.height > block.asset.width * 1.1;
        const floated = options.imageFlow === "smart" && portrait && index < blocks.length - 1;
        const side = options.imageFloatSide === "left" ? "left" : "right";
        return `<figure${floated ? ` class="smart-float ${side}"` : ""}><img src="${escape(imageSource(block))}" alt="${escape(block.alt)}">${options.showImageAltAsCaption && block.alt ? `<figcaption>${escape(block.alt)}</figcaption>` : ""}</figure>`;
      }
    }
  }).join("\n");
}

function fontFaces(families: FontFamily[]): string {
  return families.flatMap(family => Object.entries(family.styles).map(([slot, font]) => font ? `@font-face{font-family:"${family.cssFamily}";src:url(data:font/ttf;base64,${base64(font.bytes)}) format("truetype");font-weight:${slot.includes("bold") ? 600 : 400};font-style:${slot.includes("italic") ? "italic" : "normal"}}` : "")).join("\n");
}

export function renderHtml(document: MarkdownDocument, partial: Partial<RenderOptions> = {}, fonts: FontFamily[] = []): string {
  const options = resolveOptions(partial), [pageWidth] = PAGE_SIZES[options.pageSize];
  const contentWidth = (pageWidth - 2 * options.marginX) * options.contentWidthRatio;
  const metrics = typeMetrics(options.fontSize, options), body = fonts.find(font => font.id === options.bodyFont), headings = fonts.find(font => font.id === options.headingFont), mono = fonts.find(font => font.id === options.monoFont);
  const bodyFamily = body ? `"${body.cssFamily}"` : options.bodyFont === "serif" ? "Georgia,serif" : "-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif";
  const headingFamily = headings ? `"${headings.cssFamily}"` : bodyFamily;
  const monoFamily = mono ? `"${mono.cssFamily}"` : "ui-monospace,SFMono-Regular,Consolas,monospace";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
${fontFaces(fonts)}
:root{font-size:${options.fontSize}pt;color:#30363d;background:#fff}*{box-sizing:border-box}body{font-family:${bodyFamily};letter-spacing:${options.bodyLetterSpacing}em;line-height:${options.lineHeight};max-width:${contentWidth}pt;margin:${options.marginTop}pt auto ${options.marginBottom}pt;padding:0}body:after{content:"";display:block;clear:both}p{margin:0 0 ${options.paragraphSpace}em}h1,h2,h3{font-family:${headingFamily};letter-spacing:${options.headingLetterSpacing}em;font-weight:${options.boldHeadings ? 600 : 400};line-height:1.2;margin:${options.headingBefore}em 0 ${options.headingAfter}em}h1{font-size:${options.h1Scale}em}h2{font-size:${options.h2Scale}em}h3{font-size:${options.h3Scale}em}.thematic-break,table,figure:not(.smart-float){clear:both}.thematic-break{display:flex;align-items:center;justify-content:center;gap:1.05em;height:.8em;margin:${options.ruleSpace}em 0;color:#b6bec8;font-size:.72em;line-height:1}ul,ol{margin:.25em 0 .7em;padding-left:${metrics.listIndent}pt}li+li{margin-top:${options.listItemGap}em}pre{margin:.8em 0;padding:${metrics.codePad}pt ${metrics.codeSidePad}pt;background:#f6f8fa;border:1px solid #d8dee4;overflow-x:hidden;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;line-height:${options.codeLineHeight};font-size:${options.codeScale}em}code{font-family:${monoFamily};letter-spacing:${options.codeLetterSpacing}em;font-size:.92em}blockquote{margin:.8em 0;padding:.1em 0 .1em ${metrics.quoteIndent}pt;border-left:${metrics.quoteBar}pt solid #d0d7de;color:#57606a}blockquote p:last-child{margin-bottom:0}table{border-collapse:collapse;width:100%;margin:.9em 0}th,td{border:1px solid #d0d7de;padding:${metrics.cellPad * .8}pt ${metrics.cellPad}pt;text-align:left}th{font-weight:600}tr:nth-child(even){background:#f6f8fa}figure{display:table;width:max-content;max-width:100%;margin-block:${options.imageGap}em;margin-inline:${options.imageAlign === "right" ? "auto 0" : options.imageAlign === "center" ? "auto" : "0 auto"};text-align:${options.imageAlign}}figure.smart-float{width:${options.imageFloatWidthRatio * 100}%;margin-top:0;margin-bottom:${options.imageGap}em}figure.smart-float.right{float:right;margin-left:${options.imageFloatGap}em}figure.smart-float.left{float:left;margin-right:${options.imageFloatGap}em}figure.smart-float img{width:100%;max-height:${options.imageMaxHeightRatio * 100}vh;object-fit:contain}img{display:block;max-width:100%;max-height:${options.imageMaxHeightRatio * 100}vh;width:auto;height:auto;margin:0}figcaption{display:table-caption;caption-side:bottom;margin-top:${options.imageCaptionGap}em;color:#57606a;font-size:.88em;font-style:italic;text-align:center}.tok-keyword{color:#cf222e}.tok-string{color:#0a3069}.tok-number{color:#0550ae}.tok-comment{color:#6e7781}.tok-function{color:#8250df}.tok-type{color:#953800}.tok-variable{color:#116329}a{color:#0969da}
.math-inline{display:inline-block;margin:0 .04em;line-height:0;vertical-align:-.15em}.math-inline svg{display:block;max-width:none;max-height:none}.math-inline img{display:block;width:auto;height:1em;max-width:none;max-height:none}.math-display{clear:both;margin:.9em 0 1em;text-align:center;line-height:0}.math-display svg,.math-display img{display:inline-block;max-width:100%;height:auto;max-height:none;margin:0 auto}
</style></head><body>${blocksHtml(document.blocks, options)}</body></html>`;
}

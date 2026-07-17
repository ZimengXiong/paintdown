import { FontRegistry } from "./fonts.js";
import { renderHtml } from "./html.js";
import { resolveDocumentImages } from "./images.js";
import { layoutDocument } from "./layout.js";
import { parseMarkdown } from "./markdown.js";
import { renderPdf } from "./pdf.js";
import { loadStandardFonts } from "./standard-fonts.js";
import type { MarkdownDocument, RendererOptions } from "./types.js";

export function createRenderer(options: RendererOptions = {}) {
  const standard = loadStandardFonts();
  const fonts = new FontRegistry([standard.body, standard.display, standard.mono, standard.emoji, ...(options.fonts ?? [])]);
  const config = { bodyFont: standard.body.id, headingFont: standard.display.id, monoFont: standard.mono.id, ...options.config };
  const prepare = async (source: string | MarkdownDocument): Promise<MarkdownDocument> => {
    let document = typeof source === "string" ? parseMarkdown(source) : source;
    const hasMathRuns = (block: import("./types.js").Block): boolean => block.type === "paragraph" || block.type === "heading" ? block.runs.some(run => run.mathSource)
      : block.type === "list" ? block.items.some(item => item.runs.some(run => run.mathSource))
      : block.type === "table" ? [...block.header, ...block.rows.flat()].some(cell => cell.some(run => run.mathSource))
      : block.type === "quote" ? block.children.some(hasMathRuns) : block.type === "math";
    if (document.blocks.some(hasMathRuns)) {
      const { resolveDocumentMath } = await import("./mathjax.js");
      document = await resolveDocumentMath(document);
    }
    return options.imageResolver ? resolveDocumentImages(document, options.imageResolver) : document;
  };
  return {
    parse: parseMarkdown,
    prepare,
    async layout(source: string | MarkdownDocument) { const document = await prepare(source); return layoutDocument(document.blocks, fonts, config); },
    async pdf(source: string | MarkdownDocument) { const document = await prepare(source); return renderPdf(layoutDocument(document.blocks, fonts, config), fonts); },
    async html(source: string | MarkdownDocument) { const document = await prepare(source); return renderHtml(document, config, fonts.values()); },
    fonts,
  };
}

export type Renderer = ReturnType<typeof createRenderer>;

import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, FontRegistry, layoutDocument, parseMarkdown, renderHtml } from "../src/index.js";
import type { ImageAsset } from "../src/types.js";

const asset = (width: number, height: number): ImageAsset => ({
  id: `${width}x${height}`, source: "fixture.png", format: "png", mimeType: "image/png",
  width, height, channels: 3, bytes: new Uint8Array(), pixels: new Uint8Array(width * height * 3),
});

describe("typography defaults", () => {
  it("uses bold headings by default but regular body text", () => {
    expect(DEFAULT_OPTIONS.boldHeadings).toBe(true);
    const layout = layoutDocument([
      { type: "heading", level: 1, runs: [{ text: "Heading" }] },
      { type: "paragraph", runs: [{ text: "Body" }] },
    ]);
    const text = layout.pages.flat().filter(item => item.type === "text");
    expect(text.find(item => item.text === "Heading")?.bold).toBe(true);
    expect(text.find(item => item.text === "Body")?.bold).toBeFalsy();
  });

  it("applies an independently selected font family to inline and fenced code", () => {
    const layout = layoutDocument(parseMarkdown("Inline `value` here.\n\n```ts\nconst value = 3;\n```").blocks, undefined, { monoFont: "custom-mono" });
    const code = layout.pages.flat().filter(item => item.type === "text" && item.mono);
    expect(code.length).toBeGreaterThan(0);
    expect(code.every(item => item.family === "custom-mono")).toBe(true);
  });

  it("applies global tracking and centers a narrowed content measure", () => {
    const layout = layoutDocument([{ type: "paragraph", runs: [{ text: "Measured text" }] }], undefined, {
      letterSpacing: 0.05,
      contentWidthRatio: 0.5,
    });
    const text = layout.pages[0]!.find(item => item.type === "text" && item.text === "Measured")!;
    expect(text.tracking).toBeCloseTo(DEFAULT_OPTIONS.fontSize * 0.05);
    expect(text.x).toBeCloseTo(612 / 2 - (612 - 2 * DEFAULT_OPTIONS.marginX) * 0.5 / 2);
  });

  it("supports independent body, heading, and code tracking", () => {
    const layout = layoutDocument(parseMarkdown("# Heading\n\nBody `inline`.\n\n```ts\nconst x = 1;\n```").blocks, undefined, {
      bodyLetterSpacing: 0.01, headingLetterSpacing: 0.02, codeLetterSpacing: 0.03,
    });
    const text = layout.pages.flat().filter(item => item.type === "text");
    expect(text.find(item => item.text === "Heading")?.tracking).toBeCloseTo(DEFAULT_OPTIONS.fontSize * DEFAULT_OPTIONS.h1Scale * 0.02);
    expect(text.find(item => item.text === "Body")?.tracking).toBeCloseTo(DEFAULT_OPTIONS.fontSize * 0.01);
    expect(text.find(item => item.text === "inline")?.tracking).toBeCloseTo(DEFAULT_OPTIONS.fontSize * 0.92 * 0.03);
    expect(text.find(item => item.text.includes("const"))?.tracking).toBeCloseTo(DEFAULT_OPTIONS.fontSize * DEFAULT_OPTIONS.codeScale * 0.03);
  });

  it("keeps spaces inside a link's continuous underlined text run", () => {
    const layout = layoutDocument(parseMarkdown("[Links render together](https://example.com)").blocks);
    const links = layout.pages.flat().filter(item => item.type === "text" && item.link);
    expect(links).toHaveLength(1);
    expect(links[0]?.text).toBe("Links render together");
  });
});

describe("HTML output", () => {
  it("uses retained vector math instead of enlarging the PDF raster", () => {
    const vectorSvg = '<svg width="8ex" height="2ex" viewBox="0 0 800 200"><path d="M0 0h10v10z"/></svg>';
    const html = renderHtml({ source: "", blocks: [{ type: "math", source: "x^2", asset: { ...asset(2400, 600), vectorSvg, widthEm: 4, heightEm: 1 } }] });
    expect(html).toContain('<div class="math-display"');
    expect(html).toContain('<svg aria-hidden="true"');
    expect(html).not.toContain("data:image/png;base64");
  });

  it("wraps fenced code instead of adding a horizontal scroller", () => {
    const html = renderHtml(parseMarkdown("```ts\nconst exceptionallyLongIdentifier = createRendererWithManyArguments(markdown, options);\n```"));
    expect(html).toContain("white-space:pre-wrap");
    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).not.toContain("overflow:auto");
  });
});

describe("code blocks", () => {
  it("wraps long highlighted lines inside the native content box", () => {
    const layout = layoutDocument(parseMarkdown("```ts\nconst renderer = createRenderer({ config: { fontSize: 11, boldHeadings: true }, imageResolver: createFetchImageResolver(fetch, document.baseURI) });\n```" ).blocks, undefined, { contentWidthRatio: 0.55 });
    const code = layout.pages.flat().filter(item => item.type === "text" && item.mono);
    expect(new Set(code.map(item => item.y)).size).toBeGreaterThan(1);
    const rightEdge = 612 / 2 + (612 - 2 * DEFAULT_OPTIONS.marginX) * 0.55 / 2;
    const fonts = new FontRegistry();
    expect(code.every(item => item.x + fonts.measure(item.text, item.size, {
      family: item.family, mono: true, tracking: item.tracking,
    }) <= rightEdge + 0.01)).toBe(true);
  });
});

describe("image layout", () => {
  it("caps wide images at the content width without distortion", () => {
    const layout = layoutDocument([{ type: "image", source: "wide.png", alt: "", asset: asset(1600, 650) }]);
    const image = layout.pages[0]!.find(item => item.type === "image");
    expect(image?.width).toBeCloseTo(492);
    expect(image?.height).toBeCloseTo(492 * 650 / 1600);
  });

  it("does not upscale small images", () => {
    const layout = layoutDocument([{ type: "image", source: "small.png", alt: "", asset: asset(100, 100) }]);
    const image = layout.pages[0]!.find(item => item.type === "image");
    expect(image?.width).toBeCloseTo(75);
  });

  it("fits very tall images inside the usable page height", () => {
    const layout = layoutDocument([{ type: "image", source: "tall.png", alt: "Tall caption", title: "Ignored title", asset: asset(600, 1800) }]);
    const image = layout.pages[0]!.find(item => item.type === "image");
    expect(image?.height).toBeLessThanOrEqual((792 - 120) * DEFAULT_OPTIONS.imageMaxHeightRatio);
    expect(image?.width / image?.height!).toBeCloseTo(1 / 3);
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]!.some(item => item.type === "text" && item.text === "Tall")).toBe(true);
  });

  it("wraps following prose beside portrait images in smart mode", () => {
    const layout = layoutDocument([
      { type: "image", source: "portrait.png", alt: "", asset: asset(800, 1200) },
      { type: "paragraph", runs: [{ text: "Wrapped editorial copy beside the portrait image." }] },
    ]);
    const page = layout.pages[0]!, image = page.find(item => item.type === "image");
    const prose = page.find(item => item.type === "text" && item.text === "Wrapped");
    expect(image?.x).toBeGreaterThan(prose?.x ?? Infinity);
    expect(Math.abs((prose?.y ?? Infinity) - (image?.y ?? 0))).toBeLessThan(DEFAULT_OPTIONS.fontSize * DEFAULT_OPTIONS.lineHeight);
  });

  it("packs a section lead and subsequent flow beside a portrait", () => {
    const layout = layoutDocument([
      { type: "heading", level: 2, runs: [{ text: "Meet the herd" }] },
      { type: "paragraph", runs: [{ text: "A short introduction to the portrait." }] },
      { type: "image", source: "portrait.png", alt: "", asset: asset(800, 1200) },
      { type: "paragraph", runs: [{ text: "Field notes continue beside the image." }] },
      { type: "heading", level: 3, runs: [{ text: "Pasture notes" }] },
      { type: "list", ordered: false, items: [
        { depth: 0, ordered: false, runs: [{ text: "Quiet humming" }] },
        { depth: 0, ordered: false, runs: [{ text: "Padded feet" }] },
      ] },
    ]);
    const page = layout.pages[0]!, image = page.find(item => item.type === "image")!;
    for (const word of ["Meet", "Field", "Pasture", "Quiet"]) {
      const item = page.find(candidate => candidate.type === "text" && candidate.text === word)!;
      expect(item.x).toBeLessThan(image.x);
      expect(item.y).toBeLessThan(image.y + image.height);
    }
  });

  it("adopts later chronological sections until the portrait ends", () => {
    const blocks = [
      { type: "heading" as const, level: 2 as const, runs: [{ text: "Tall order" }] },
      { type: "paragraph" as const, runs: [{ text: "A short introduction." }] },
      { type: "image" as const, source: "tall.png", alt: "", asset: asset(600, 1600) },
      { type: "paragraph" as const, runs: [{ text: "The figure keeps its aspect ratio." }] },
      { type: "heading" as const, level: 2 as const, runs: [{ text: "Markdown snacks" }] },
      { type: "paragraph" as const, runs: [{ text: "Bold, italic, code, and links." }] },
      { type: "list" as const, ordered: false, items: [
        { depth: 0, ordered: false, runs: [{ text: "Hanging indents" }] },
        { depth: 0, ordered: false, runs: [{ text: "Nested levels" }] },
      ] },
    ];
    const layout = layoutDocument(blocks);
    const image = layout.pages.flat().find(item => item.type === "image")!;
    const next = layout.pages.flat().find(item => item.type === "text" && item.text === "Markdown")!;
    expect(next.x).toBeLessThan(image.x);
    expect(next.y).toBeLessThan(image.y + image.height);
  });

  it("keeps a short landscape figure introduction with the unchanged image", () => {
    const filler = Array.from({ length: 18 }, (_, index) => ({ type: "paragraph" as const, runs: [{ text: `Filler-${index}` }] }));
    const blocks = [...filler,
      { type: "heading" as const, level: 2 as const, runs: [{ text: "FigureHeading" }] },
      { type: "paragraph" as const, runs: [{ text: "A short lead paragraph." }] },
      { type: "image" as const, source: "wide.png", alt: "", asset: asset(1200, 400) },
    ];
    const layout = layoutDocument(blocks);
    const pageOf = (text: string) => layout.pages.findIndex(page => page.some(item => item.type === "text" && item.text === text));
    const imagePage = layout.pages.findIndex(page => page.some(item => item.type === "image"));
    expect(pageOf("FigureHeading")).toBe(imagePage);
    expect(imagePage).toBe(1);
    const image = layout.pages.flat().find(item => item.type === "image")!;
    expect(image.width).toBeCloseTo(492);
    expect(image.height).toBeCloseTo(164);
  });

  it("does not anchor more than three lead paragraphs to a figure", () => {
    const filler = Array.from({ length: 14 }, (_, index) => ({ type: "paragraph" as const, runs: [{ text: `Filler-${index}` }] }));
    const leads = Array.from({ length: 4 }, (_, index) => ({ type: "paragraph" as const, runs: [{ text: `Lead-${index}` }] }));
    const layout = layoutDocument([...filler,
      { type: "heading", level: 2, runs: [{ text: "LongIntroduction" }] }, ...leads,
      { type: "image", source: "wide.png", alt: "", asset: asset(1200, 400) },
    ]);
    const headingPage = layout.pages.findIndex(page => page.some(item => item.type === "text" && item.text === "LongIntroduction"));
    const imagePage = layout.pages.findIndex(page => page.some(item => item.type === "image"));
    expect(headingPage).toBe(0);
    expect(imagePage).toBe(1);
  });

  it("continues display math inside an active portrait wrap", () => {
    const layout = layoutDocument([
      { type: "heading", level: 2, runs: [{ text: "Tall order" }] },
      { type: "paragraph", runs: [{ text: "A short introduction." }] },
      { type: "image", source: "tall.png", alt: "", asset: asset(600, 1800) },
      { type: "paragraph", runs: [{ text: "The aspect ratio stays intact." }] },
      { type: "heading", level: 2, runs: [{ text: "Math break" }] },
      { type: "paragraph", runs: [{ text: "Typesetting continues beside the figure." }] },
      { type: "math", source: "\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}" },
    ]);
    const page = layout.pages[0]!, image = page.find(item => item.type === "image")!;
    const math = page.filter(item => item.type === "text" && /[∫∞π]/u.test(item.text));
    expect(math.length).toBeGreaterThan(0);
    expect(math.every(item => item.x < image.x && item.y < image.y + image.height)).toBe(true);
  });

  it("decorates unused space inside a smart float column", () => {
    const layout = layoutDocument([
      { type: "image", source: "portrait.png", alt: "", asset: asset(800, 1200) },
      { type: "paragraph", runs: [{ text: "Short wrapped copy." }] },
    ], undefined, { blankSpaceDecoration: "dot-grid" });
    const page = layout.pages[0]!, image = page.find(item => item.type === "image")!;
    const internalDots = page.filter(item => item.type === "rect" && item.x < image.x && item.y < image.y + image.height);
    expect(internalDots.length).toBeGreaterThan(10);
  });

  it("joins adjacent internal and page-level dot fields", () => {
    const layout = layoutDocument([
      { type: "image", source: "portrait.png", alt: "", asset: asset(800, 1200) },
      { type: "paragraph", runs: [{ text: "Short copy." }] },
    ], undefined, { blankSpaceDecoration: "dot-grid" });
    const page = layout.pages[0]!, image = page.find(item => item.type === "image")!;
    const dots = page.filter(item => item.type === "rect" && item.width < DEFAULT_OPTIONS.fontSize * 0.2);
    const internal = dots.filter(dot => dot.x < image.x && dot.y < image.y + image.height);
    const below = dots.filter(dot => dot.y >= image.y + image.height);
    const internalBottom = Math.max(...internal.map(dot => dot.y + dot.height));
    const belowTop = Math.min(...below.map(dot => dot.y));
    expect(belowTop - internalBottom).toBeLessThan(DEFAULT_OPTIONS.fontSize);
  });

  it("leaves the normal content gap after a floated image caption", () => {
    const layout = layoutDocument([
      { type: "heading", level: 2, runs: [{ text: "Portrait" }] },
      { type: "image", source: "portrait.png", alt: "A wrapped portrait caption", asset: asset(800, 1200) },
      { type: "paragraph", runs: [{ text: "Short copy beside the image." }] },
    ], undefined, { blankSpaceDecoration: "dot-grid" });
    const page = layout.pages[0]!, image = page.find(item => item.type === "image")!;
    const caption = page.find(item => item.type === "text" && item.text.includes("caption"))!;
    const dotsBelowCaption = page.filter(item => item.type === "rect" && item.width < DEFAULT_OPTIONS.fontSize * 0.2
      && item.x >= image.x && item.y > image.y + image.height);
    expect(dotsBelowCaption.length).toBeGreaterThan(0);
    expect(Math.min(...dotsBelowCaption.map(dot => dot.y)) - (caption.y + caption.size)).toBeGreaterThan(DEFAULT_OPTIONS.fontSize);
  });
});

describe("table rendering", () => {
  it("insets zebra fills so they do not double the grid edge", () => {
    const layout = layoutDocument(parseMarkdown("| A | B |\n| - | - |\n| one | two |\n| three | four |").blocks);
    const page = layout.pages[0]!;
    const fill = page.find(item => item.type === "rect" && item.color[0] === 0.965)!;
    const leftEdge = Math.min(...page.filter(item => item.type === "line").map(item => Math.min(item.x1, item.x2)));
    expect(fill.x).toBeGreaterThan(leftEdge);
  });
});

describe("blank-space decoration", () => {
  it("adds the dot field only below content", () => {
    const layout = layoutDocument(
      [{ type: "paragraph", runs: [{ text: "A short page." }] }],
      undefined,
      { blankSpaceDecoration: "dot-grid" },
    );
    const text = layout.pages[0]!.find(item => item.type === "text")!;
    const dots = layout.pages[0]!.filter(item => item.type === "rect");
    expect(dots.length).toBeGreaterThan(10);
    expect(Math.min(...dots.map(dot => dot.y))).toBeGreaterThan(text.y + text.size);
  });
});

describe("pagination invariants", () => {
  const pageOfText = (layout: ReturnType<typeof layoutDocument>, text: string) =>
    layout.pages.findIndex(page => page.some(item => item.type === "text" && item.text === text));

  it("never strands a heading away from its following paragraph", () => {
    const filler = Array.from({ length: 28 }, (_, index) => ({ type: "paragraph" as const, runs: [{ text: `Filler-${index}` }] }));
    const layout = layoutDocument([...filler,
      { type: "heading", level: 2 as const, runs: [{ text: "KeptHeading" }] },
      { type: "paragraph" as const, runs: [{ text: "KeptParagraph" }] },
    ]);
    expect(pageOfText(layout, "KeptHeading")).toBe(pageOfText(layout, "KeptParagraph"));
  });

});

describe("LaTeX mathematics", () => {
  it("parses inline and display dollar syntax", () => {
    const document = parseMarkdown("Euler wrote $e^{i\\pi}+1=0$.\n\n$$\n\\frac{1}{\\sqrt{x}}\n$$");
    const paragraph = document.blocks[0];
    expect(paragraph?.type).toBe("paragraph");
    expect(paragraph?.type === "paragraph" && paragraph.runs.some(run => run.math && run.text.includes("π"))).toBe(true);
    expect(document.blocks[1]).toEqual({ type: "math", source: "\\frac{1}{\\sqrt{x}}" });
  });

  it("composes display fractions, roots, and scripts as native draw items", () => {
    const document = parseMarkdown("$$\n\\int_0^\\infty e^{-x^2} = \\frac{\\sqrt{\\pi}}{2}\n$$");
    const layout = layoutDocument(document.blocks);
    const page = layout.pages[0]!;
    expect(page.some(item => item.type === "text" && item.text === "∫")).toBe(true);
    expect(page.filter(item => item.type === "line").length).toBeGreaterThanOrEqual(2);
  });
});

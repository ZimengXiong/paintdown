import { DEFAULT_OPTIONS, HEADING_LINE_HEIGHT, PAGE_SIZES, resolveOptions, typeMetrics } from "./config.js";
import { FontRegistry } from "./fonts.js";
import { CODE_COLORS, highlightCodeLine, type CodeRun, type CodeToken } from "./highlight.js";
import { typesetDisplayMath } from "./math.js";
import type { Block, Color, DrawItem, InlineRun, LayoutResult, RenderOptions, TextItem } from "./types.js";

interface Word extends InlineRun { width: number; size: number; space: boolean; family: string; mono: boolean; tracking: number; assetWidth?: number; assetHeight?: number }
interface LaidCodeRun extends CodeRun { family: string }
interface Atom { height: number; items: DrawItem[] }
interface Compiled { type: Block["type"]; atoms: Atom[]; before: number; after: number; splitMin?: number; keep?: boolean; decoration?: "code" | "quote"; flow?: "float"; startType?: Block["type"]; endType?: Block["type"] }

const BODY: Color = [0.19, 0.21, 0.24];
const MUTED: Color = [0.3, 0.32, 0.38];
const BORDER: Color = [0.82, 0.85, 0.87];

export function layoutDocument(blocks: Block[], fonts = new FontRegistry(), partial: Partial<RenderOptions> = {}): LayoutResult {
  const options = resolveOptions(partial), [pageWidth, pageHeight] = PAGE_SIZES[options.pageSize];
  const availableWidth = pageWidth - 2 * options.marginX;
  const contentWidth = availableWidth * options.contentWidthRatio, contentX = (pageWidth - contentWidth) / 2;
  const em = options.fontSize, lineHeight = em * options.lineHeight;
  const metrics = typeMetrics(em, options), compiled: Compiled[] = [];

  const measure = (text: string, size: number, run: Partial<InlineRun> = {}, family = run.code ? options.monoFont : options.bodyFont,
    tracking = (run.code ? options.codeLetterSpacing : options.bodyLetterSpacing) * size) =>
    fonts.measure(text, size, { family, bold: run.bold, italic: run.italic, mono: run.code, tracking });

  function grayDotGrid(x: number, y: number, width: number, height: number, seed: number): DrawItem[] {
    let state = (seed ^ 0x9e3779b9) >>> 0;
    const random = () => {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      return (state >>> 0) / 0x100000000;
    };
    const items: DrawItem[] = [], step = 1.15 * em;
    const columns = Math.floor(width / step), rows = Math.floor(height / step);
    const insetX = (width - columns * step) / 2, insetY = (height - rows * step) / 2;
    for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
      const intensity = random(), shade = 0.76 + intensity * 0.2;
      const size = Math.max(0.8, em * (0.075 + random() * 0.055));
      items.push({ type: "rect", x: x + insetX + column * step - size / 2, y: y + insetY + row * step - size / 2,
        width: size, height: size, color: [shade, shade, shade] });
    }
    return items;
  }

  function wrap(runs: InlineRun[], size: number, width: number, config: { family?: string; tracking?: number; letterSpacing?: number; upper?: boolean; firstIndent?: number } = {}): Word[][] {
    const words: Word[] = [], family = config.family ?? options.bodyFont;
    for (const run of runs) {
      if (run.mathAsset) {
        const assetWidth = (run.mathAsset.widthEm ?? run.mathAsset.width / (run.mathAsset.pixelRatio ?? 1) * 72 / options.imageDpi / size) * size;
        const assetHeight = (run.mathAsset.heightEm ?? run.mathAsset.height / (run.mathAsset.pixelRatio ?? 1) * 72 / options.imageDpi / size) * size;
        words.push({ ...run, text: "", space: false, mono: false, family, size, tracking: 0, width: assetWidth, assetWidth, assetHeight });
        continue;
      }
      for (const part of (config.upper ? run.text.toUpperCase() : run.text).split(/(\s+)/)) {
        if (!part) continue;
        const mono = !!run.code, wordSize = mono ? size * 0.92 : size;
        const tracking = (mono ? options.codeLetterSpacing : config.letterSpacing ?? options.bodyLetterSpacing) * wordSize + (config.tracking ?? 0);
        const preferredFamily = mono ? options.monoFont : family;
        const segments: { text: string; family: string }[] = [];
        for (const char of part) {
          const codePoint = char.codePointAt(0)!;
          if (codePoint === 0xfe0e || codePoint === 0xfe0f) continue;
          const resolvedFamily = fonts.familyForCodePoint(preferredFamily, codePoint, !!run.bold, !!run.italic);
          const previous = segments.at(-1);
          if (previous?.family === resolvedFamily) previous.text += char;
          else segments.push({ text: char, family: resolvedFamily });
        }
        for (const segment of segments) words.push({ ...run, text: segment.text, space: /^\s+$/.test(segment.text), mono,
          family: segment.family, size: wordSize, tracking,
          width: fonts.measure(segment.text, wordSize, { family: segment.family, bold: run.bold, italic: run.italic, mono, tracking }) });
      }
    }
    const lines: Word[][] = []; let line: Word[] = [], used = 0, max = width - (config.firstIndent ?? 0);
    for (const word of words) {
      if (word.space && !line.length) continue;
      if (!word.space && line.length && used + word.width > max) {
        while (line.at(-1)?.space) used -= line.pop()!.width;
        lines.push(line); line = []; used = 0; max = width;
      }
      line.push(word); used += word.width;
    }
    while (line.at(-1)?.space) line.pop();
    if (line.length) lines.push(line);
    return lines.length ? lines : [[]];
  }

  function makeLine(words: Word[], x: number, y: number, baseSize: number, extraSpace = 0): DrawItem[] {
    const result: DrawItem[] = []; let cursor = x, segment: TextItem | undefined, key = "";
    const flush = () => { if (segment) result.push(segment); segment = undefined; };
    for (const word of words) {
      if (word.mathAsset && word.assetWidth != null && word.assetHeight != null) {
        flush();
        const baseline = y + baseSize * 0.86;
        result.push({ type: "image", x: cursor, y: baseline - word.assetHeight * (word.mathAsset.baselineRatio ?? 0.8), width: word.assetWidth, height: word.assetHeight, asset: word.mathAsset });
        cursor += word.width;
        continue;
      }
      if (word.space && !word.link && !word.strike) { flush(); cursor += word.width + extraSpace; continue; }
      const nextKey = [word.bold, word.italic, word.strike, word.mono, word.family, word.tracking, word.link].join("|");
      if (segment && nextKey === key) segment.text += word.text;
      else {
        flush(); key = nextKey;
        segment = { type: "text", x: cursor, y: y + (word.mono ? (baseSize - word.size) * 0.86 : 0), size: word.size,
          text: word.text, family: word.family, bold: word.bold, italic: word.italic, mono: word.mono,
          tracking: word.tracking, link: word.link, strike: word.strike, color: word.link ? [0.04, 0.41, 0.85] : BODY };
      }
      cursor += word.width;
    }
    flush(); return result;
  }

  function textAtoms(runs: InlineRun[], size: number, width: number, rowHeight: number,
    config: { family?: string; tracking?: number; letterSpacing?: number; upper?: boolean; firstIndent?: number; justify?: boolean; x?: number } = {}): Atom[] {
    const lines = wrap(runs, size, width, config);
    return lines.map((words, index) => {
      const indent = index ? 0 : config.firstIndent ?? 0, natural = words.reduce((sum, word) => sum + word.width, 0);
      const spaces = words.filter(word => word.space && !word.link && !word.strike).length, deficit = width - indent - natural;
      const extra = config.justify && index < lines.length - 1 && spaces && deficit > 0 && deficit < width * 0.28 ? deficit / spaces : 0;
      const mathAscent = Math.max(0, ...words.map(word => word.assetHeight ? word.assetHeight * (word.mathAsset?.baselineRatio ?? 0.8) : 0));
      const mathDescent = Math.max(0, ...words.map(word => word.assetHeight ? word.assetHeight * (1 - (word.mathAsset?.baselineRatio ?? 0.8)) : 0));
      let height = Math.max(rowHeight, mathAscent + mathDescent);
      const baseline = Math.max((height - size) * 0.3 + size * 0.86, mathAscent);
      height = Math.max(height, baseline + mathDescent);
      return { height, items: makeLine(words, (config.x ?? 0) + indent, baseline - size * 0.86, size, extra) };
    });
  }

  function centerAtoms(atoms: Atom[], left: number, width: number): void {
    for (const atom of atoms) {
      const horizontal = atom.items.flatMap(item => {
        if (item.type === "text") return [[item.x, item.x + measure(item.text, item.size, item, item.family, item.tracking)] as const];
        if (item.type === "image" || item.type === "rect") return [[item.x, item.x + item.width] as const];
        return [[Math.min(item.x1, item.x2), Math.max(item.x1, item.x2)] as const];
      });
      if (!horizontal.length) continue;
      const currentLeft = Math.min(...horizontal.map(edge => edge[0]));
      const currentRight = Math.max(...horizontal.map(edge => edge[1]));
      const shift = left + (width - (currentRight - currentLeft)) / 2 - currentLeft;
      for (const item of atom.items) {
        if (item.type === "text" || item.type === "image" || item.type === "rect") item.x += shift;
        else { item.x1 += shift; item.x2 += shift; }
      }
    }
  }

  function wrapCodeLine(line: string, language: string, size: number, width: number): LaidCodeRun[][] {
    const tracking = options.codeLetterSpacing * size;
    const glyphs: { text: string; token: CodeToken; family: string; width: number }[] = [];
    for (const run of highlightCodeLine(line.replace(/\t/g, "    "), language)) for (const text of run.text) {
      const codePoint = text.codePointAt(0)!;
      if (codePoint === 0xfe0e || codePoint === 0xfe0f) continue;
      const family = fonts.familyForCodePoint(options.monoFont, codePoint);
      glyphs.push({ text, token: run.token, family, width: fonts.measure(text, size, { family, mono: true, tracking }) });
    }
    if (!glyphs.length) return [[{ text: " ", token: "plain", family: options.monoFont }]];

    const result: LaidCodeRun[][] = [];
    let start = 0;
    while (start < glyphs.length) {
      let used = 0, end = start, preferredBreak = -1;
      while (end < glyphs.length && (used + glyphs[end]!.width <= width || end === start)) {
        used += glyphs[end]!.width;
        if (/\s|[,;)}\]]/.test(glyphs[end]!.text)) preferredBreak = end + 1;
        end++;
      }
      if (end < glyphs.length && preferredBreak > start) end = preferredBreak;

      const slice = glyphs.slice(start, end);
      while (slice.length > 1 && /\s/.test(slice.at(-1)!.text)) slice.pop();
      const runs: LaidCodeRun[] = [];
      for (const glyph of slice) {
        const previous = runs.at(-1);
        if (previous?.token === glyph.token && previous.family === glyph.family) previous.text += glyph.text;
        else runs.push({ text: glyph.text, token: glyph.token, family: glyph.family });
      }
      result.push(runs.length ? runs : [{ text: " ", token: "plain", family: options.monoFont }]);
      start = end;
      while (start < glyphs.length && /\s/.test(glyphs[start]!.text)) start++;
    }
    return result;
  }

  const spacing = {
    paragraph: [0, options.paragraphSpace], list: [0.55, 0.7], code: [0.8, 0.8], quote: [0.8, 0.8],
    table: [0.9, 0.9], image: [options.imageGap, options.imageGap], math: [0.9, 1], rule: [options.ruleSpace, options.ruleSpace],
  } as const;

  const figureLeadHeadings = new Set<number>(), figureLeadParagraphs = new Set<number>();
  for (let index = 0; index < blocks.length; index++) {
    if (blocks[index]?.type !== "heading") continue;
    let cursor = index + 1, paragraphs = 0;
    while (blocks[cursor]?.type === "paragraph" && paragraphs < 4) { cursor++; paragraphs++; }
    if (paragraphs <= 3 && blocks[cursor]?.type === "image") {
      figureLeadHeadings.add(index);
      for (let lead = index + 1; lead < cursor; lead++) figureLeadParagraphs.add(lead);
    }
  }

  const gapBetween = (previous: Compiled | undefined, next: Compiled) => {
    if (!previous) return 0;
    const previousType = previous.endType ?? previous.type, nextType = next.startType ?? next.type;
    if (previousType === "rule" || nextType === "rule") return options.ruleSpace * em * options.blockGap;
    let gap = Math.max(previous.after, next.before);
    if (previousType === "heading") gap = previous.after;
    if (previousType === "paragraph" && ["list", "code", "quote", "math", "image"].includes(nextType)) {
      gap = nextType === "image" && next.flow === "float"
        ? options.paragraphSpace
        : Math.max(next.before * options.attachTight, 0.15);
      if (nextType === "list") gap = Math.max(gap, options.listItemGap);
    }
    return gap * em * options.blockGap;
  };

  function columnBlock(block: Block, width: number, x: number): Compiled | undefined {
    if (block.type === "heading") {
      const scale = [options.h1Scale, options.h2Scale, options.h3Scale][block.level - 1]!, size = em * scale;
      const smallCaps = block.level === 2 && options.smallCapsH2, headingSize = smallCaps ? size * 0.82 : size;
      const runs = block.runs.map(run => ({ ...run, bold: run.bold || options.boldHeadings }));
      return { type: block.type, atoms: textAtoms(runs, headingSize, width, headingSize * HEADING_LINE_HEIGHT[block.level - 1]!, {
        x, family: options.headingFont, letterSpacing: options.headingLetterSpacing, upper: smallCaps,
        tracking: smallCaps ? headingSize * 0.08 : 0,
      }), before: options.headingBefore * scale * 0.75, after: options.headingAfter * scale * 0.8 };
    }
    if (block.type === "paragraph") return { type: block.type,
      atoms: textAtoms(block.runs, em, width, lineHeight, { x, justify: options.justify }),
      before: 0, after: spacing.paragraph[1], splitMin: 2 };
    if (block.type === "list") {
      const atoms: Atom[] = []; let ordered = 0;
      block.items.forEach((item, itemIndex) => {
        const indent = metrics.listIndent * (1 + item.depth), lines = wrap(item.runs, em, width - indent);
        const marker = item.ordered ? `${++ordered}.` : item.depth ? "◦" : "•";
        lines.forEach((words, lineIndex) => {
          const itemGap = lineIndex === 0 && itemIndex > 0 ? options.listItemGap * em : 0;
          const items = makeLine(words, x + indent, itemGap, em);
          if (!lineIndex) items.unshift({ type: "text", x: x + indent - measure(`${marker}  `, em), y: itemGap,
            size: em, text: `${marker} `, family: options.bodyFont, color: MUTED });
          atoms.push({ height: lineHeight + itemGap, items });
        });
      });
      return { type: block.type, atoms, before: spacing.list[0], after: spacing.list[1], splitMin: 1 };
    }
    if (block.type === "math") {
      if (block.asset) {
        const ratio = block.asset.pixelRatio ?? 1;
        const intrinsicWidth = block.asset.widthEm != null ? block.asset.widthEm * em * 1.12 : block.asset.width / ratio * 72 / options.imageDpi;
        const intrinsicHeight = block.asset.heightEm != null ? block.asset.heightEm * em * 1.12 : block.asset.height / ratio * 72 / options.imageDpi;
        const scale = Math.min(1, width / intrinsicWidth), mathWidth = intrinsicWidth * scale, mathHeight = intrinsicHeight * scale;
        return { type: block.type, atoms: [{ height: mathHeight, items: [{ type: "image", x: x + (width - mathWidth) / 2,
          y: 0, width: mathWidth, height: mathHeight, asset: block.asset }] }], before: spacing.math[0], after: spacing.math[1] };
      }
      const equation = typesetDisplayMath(block.source, em * 1.12, options.bodyFont,
        (text, size, italic) => fonts.measure(text, size, { family: options.bodyFont, italic }));
      const scale = equation.width > width ? width / equation.width : 1;
      if (scale < 1) {
        for (const item of equation.items) {
          if (item.type === "text" || item.type === "rect" || item.type === "image") {
            item.x *= scale; item.y *= scale;
            if (item.type === "text") item.size *= scale; else { item.width *= scale; item.height *= scale; }
          } else { item.x1 *= scale; item.x2 *= scale; item.y1 *= scale; item.y2 *= scale; item.width *= scale; }
        }
        equation.width *= scale; equation.height *= scale;
      }
      const offset = x + (width - equation.width) / 2;
      for (const item of equation.items) {
        if (item.type === "text" || item.type === "rect" || item.type === "image") item.x += offset;
        else { item.x1 += offset; item.x2 += offset; }
      }
      return { type: block.type, atoms: [{ height: equation.height, items: equation.items }], before: spacing.math[0], after: spacing.math[1] };
    }
    return undefined;
  }

  let floatedFigures = 0;
  function editorialSection(start: number): { block: Compiled; end: number } | undefined {
    const heading = blocks[start];
    if (options.imageFlow !== "smart" || heading?.type !== "heading") return;
    let imageIndex = start + 1;
    while (imageIndex <= start + 2 && blocks[imageIndex]?.type === "paragraph") imageIndex++;
    const imageBlock = blocks[imageIndex];
    if (imageBlock?.type !== "image" || !imageBlock.asset || imageBlock.asset.height <= imageBlock.asset.width * 1.1) return;

    const captionReserve = options.showImageAltAsCaption && imageBlock.alt ? em * (options.imageCaptionGap + 0.88 * 1.12) : 0;
    const usablePageHeight = pageHeight - options.marginTop - options.marginBottom;
    const usableHeight = Math.max(em * 6, usablePageHeight * options.imageMaxHeightRatio - captionReserve);
    const intrinsicWidth = imageBlock.asset.width * 72 / options.imageDpi;
    const intrinsicHeight = imageBlock.asset.height * 72 / options.imageDpi;
    const imageScale = Math.min(contentWidth * options.imageFloatWidthRatio / intrinsicWidth, usableHeight / intrinsicHeight,
      options.imageAllowUpscale ? Infinity : 1);
    const width = intrinsicWidth * imageScale, height = intrinsicHeight * imageScale, gutter = options.imageFloatGap * em;
    const textWidth = contentWidth - width - gutter;
    if (textWidth < contentWidth * 0.38) return;
    const side = options.imageFloatSide === "alternate" ? (floatedFigures++ % 2 ? "left" : "right") : options.imageFloatSide;
    const imageX = side === "left" ? 0 : contentWidth - width, textX = side === "left" ? width + gutter : 0;

    const figureItems: DrawItem[] = [{ type: "image", x: imageX, y: 0, width, height, asset: imageBlock.asset }];
    let figureHeight = height;
    if (options.showImageAltAsCaption && imageBlock.alt) {
      const captionSize = em * 0.88, captionLine = captionSize * 1.12;
      const captions = textAtoms([{ text: imageBlock.alt, italic: true }], captionSize, width, captionLine, { x: imageX, family: options.bodyFont });
      centerAtoms(captions, imageX, width);
      if (captions.length) captions[0]!.height += options.imageCaptionGap * em;
      let captionY = height;
      for (const atom of captions) {
        for (const item of atom.items) {
          const copy = { ...item } as DrawItem;
          if (copy.type === "text" || copy.type === "rect" || copy.type === "image") {
            copy.y += captionY + options.imageCaptionGap * em; if (copy.type === "text") copy.color = MUTED;
          } else { copy.y1 += captionY; copy.y2 += captionY; }
          figureItems.push(copy);
        }
        captionY += atom.height;
      }
      figureHeight = captionY;
    }

    const column: Compiled[] = [];
    for (let index = start; index < imageIndex; index++) {
      const compiledBlock = columnBlock(blocks[index]!, textWidth, textX);
      if (!compiledBlock) return;
      column.push(compiledBlock);
    }
    let end = imageIndex, textHeight = 0;
    const heightWith = (candidate: Compiled) => textHeight + gapBetween(column.at(-1), candidate)
      + candidate.atoms.reduce((sum, atom) => sum + atom.height, 0);
    let heightPrevious: Compiled | undefined;
    for (const part of column) {
      textHeight += gapBetween(heightPrevious, part) + part.atoms.reduce((sum, atom) => sum + atom.height, 0);
      heightPrevious = part;
    }

    for (let index = imageIndex + 1; index < blocks.length; index++) {
      const source = blocks[index]!;
      if (source.type === "heading") {
        const introducesImage = blocks.slice(index + 1, index + 3).some(next => next.type === "image");
        if (introducesImage) break;
        const headingPart = columnBlock(source, textWidth, textX), following = blocks[index + 1],
          followingPart = following ? columnBlock(following, textWidth, textX) : undefined;
        if (!headingPart || !followingPart || following?.type === "heading") break;
        let projected = textHeight, projectedPrevious = column.at(-1);
        for (const part of [headingPart, followingPart]) {
          projected += gapBetween(projectedPrevious, part) + part.atoms.reduce((sum, atom) => sum + atom.height, 0);
          projectedPrevious = part;
        }
        if (projected > figureHeight) break;
        column.push(headingPart, followingPart); textHeight = projected; end = index + 1; index++;
        continue;
      }
      const candidate = columnBlock(source, textWidth, textX);
      if (!candidate) break;
      const candidateHeight = heightWith(candidate);
      if (index > imageIndex + 1 && candidateHeight > figureHeight) break;
      column.push(candidate); textHeight = candidateHeight; end = index;
    }

    let y = 0; let previous: Compiled | undefined;
    for (const part of column) {
      y += gapBetween(previous, part);
      for (const atom of part.atoms) {
        for (const item of atom.items) {
          const copy = { ...item } as DrawItem;
          if (copy.type === "text" || copy.type === "rect" || copy.type === "image") copy.y += y;
          else { copy.y1 += y; copy.y2 += y; }
          figureItems.push(copy);
        }
        y += atom.height;
      }
      previous = part;
    }
    if (options.blankSpaceDecoration === "dot-grid" && height - y >= 3 * em) {
      const top = y + 1.25 * em, bottom = height;
      figureItems.unshift(...grayDotGrid(textX, top, textWidth, bottom - top, options.blankSpaceDecorationSeed ^ 0x51f15e ^ start));
    }
    return { block: { type: "image", atoms: [{ height: Math.max(figureHeight, y), items: figureItems }],
      before: column[0]!.before, after: column.at(-1)!.after, flow: "float",
      startType: column[0]!.type, endType: column.at(-1)!.type }, end };
  }

  for (let sourceIndex = 0; sourceIndex < blocks.length; sourceIndex++) {
    const editorial = editorialSection(sourceIndex);
    if (editorial) { compiled.push(editorial.block); sourceIndex = editorial.end; continue; }
    const block = blocks[sourceIndex]!;
    if (block.type === "heading") {
      const scale = [options.h1Scale, options.h2Scale, options.h3Scale][block.level - 1]!, size = em * scale;
      const smallCaps = block.level === 2 && options.smallCapsH2;
      const headingSize = smallCaps ? size * 0.82 : size;
      const runs = block.runs.map(run => ({ ...run, bold: run.bold || options.boldHeadings }));
      const atoms = textAtoms(runs, headingSize, contentWidth, headingSize * HEADING_LINE_HEIGHT[block.level - 1]!, {
        family: options.headingFont, letterSpacing: options.headingLetterSpacing, upper: smallCaps, tracking: smallCaps ? headingSize * 0.08 : 0,
      });
      compiled.push({ type: block.type, atoms, before: options.headingBefore * scale * 0.75, after: options.headingAfter * scale * 0.8,
        keep: options.keepWithNext || figureLeadHeadings.has(sourceIndex) });
    } else if (block.type === "paragraph") {
      let indent = options.indentStyle === "all" || (options.indentStyle === "book" && compiled.at(-1)?.type === "paragraph") ? em * 1.8 : 0;
      if (indent && block.runs.reduce((w, run) => w + measure(run.text, run.code ? em * 0.92 : em, run), 0) <= contentWidth) indent = 0;
      compiled.push({ type: block.type, atoms: textAtoms(block.runs, em, contentWidth, lineHeight, { firstIndent: indent, justify: options.justify }),
        before: 0, after: spacing.paragraph[1], splitMin: 2, keep: figureLeadParagraphs.has(sourceIndex) });
    } else if (block.type === "list") {
      const atoms: Atom[] = []; let ordered = 0;
      block.items.forEach((item, itemIndex) => {
        const indent = metrics.listIndent * (1 + item.depth), lines = wrap(item.runs, em, contentWidth - indent);
        const marker = item.ordered ? `${++ordered}.` : item.depth ? "◦" : "•";
        lines.forEach((words, lineIndex) => {
          const gap = lineIndex === 0 && itemIndex > 0 ? options.listItemGap * em : 0;
          const items = makeLine(words, indent, gap, em);
          if (!lineIndex) items.unshift({ type: "text", x: indent - measure(`${marker}  `, em), y: gap, size: em, text: `${marker} `, family: options.bodyFont, color: MUTED });
          atoms.push({ height: lineHeight + gap, items });
        });
      });
      compiled.push({ type: block.type, atoms, before: spacing.list[0], after: spacing.list[1], splitMin: 1 });
    } else if (block.type === "code") {
      const size = em * options.codeScale, rowHeight = size * options.codeLineHeight;
      const codeWidth = contentWidth - 2 * metrics.codeSidePad;
      const atoms = (block.lines.length ? block.lines : [""]).flatMap(line => wrapCodeLine(line, block.lang, size, codeWidth)).map(runs => {
        let x = metrics.codeSidePad;
        const items = runs.map(run => {
          const tracking = options.codeLetterSpacing * size;
          const item: TextItem = { type: "text", x, y: (rowHeight - size) / 2, size, text: run.text, family: run.family, mono: true, tracking, color: CODE_COLORS[run.token] ?? CODE_COLORS.plain };
          x += fonts.measure(run.text, size, { family: run.family, mono: true, tracking }); return item;
        });
        return { height: rowHeight, items };
      });
      compiled.push({ type: block.type, atoms, before: spacing.code[0], after: spacing.code[1], splitMin: 2, decoration: "code" });
    } else if (block.type === "quote") {
      const atoms: Atom[] = [];
      for (const child of block.children) if (child.type === "paragraph") for (const words of wrap(child.runs, em, contentWidth - 2 * metrics.quoteIndent)) {
        const items = makeLine(words, metrics.quoteIndent, (lineHeight - em) / 2, em);
        for (const item of items) if (item.type === "text") item.color = [0.28, 0.29, 0.33];
        atoms.push({ height: lineHeight, items });
      }
      compiled.push({ type: block.type, atoms, before: spacing.quote[0], after: spacing.quote[1], splitMin: 2, decoration: "quote" });
    } else if (block.type === "rule") {
      const ornament = "•   •   •", width = measure(ornament, em * 0.72);
      compiled.push({ type: block.type, atoms: [{ height: em * 0.8, items: [{ type: "text", x: (contentWidth - width) / 2, y: 0, size: em * 0.72, text: ornament, family: options.bodyFont, color: BORDER }] }], before: spacing.rule[0], after: spacing.rule[1] });
    } else if (block.type === "math") {
      if (block.asset) {
        const ratio = block.asset.pixelRatio ?? 1;
        const intrinsicWidth = block.asset.widthEm != null ? block.asset.widthEm * em * 1.12 : block.asset.width / ratio * 72 / options.imageDpi;
        const intrinsicHeight = block.asset.heightEm != null ? block.asset.heightEm * em * 1.12 : block.asset.height / ratio * 72 / options.imageDpi;
        const scale = Math.min(1, contentWidth / intrinsicWidth);
        const width = intrinsicWidth * scale, height = intrinsicHeight * scale;
        compiled.push({ type: block.type, atoms: [{ height, items: [{ type: "image", x: (contentWidth - width) / 2, y: 0, width, height, asset: block.asset }] }], before: spacing.math[0], after: spacing.math[1] });
        continue;
      }
      const equation = typesetDisplayMath(block.source, em * 1.12, options.bodyFont,
        (text, size, italic) => fonts.measure(text, size, { family: options.bodyFont, italic }));
      const scale = equation.width > contentWidth ? contentWidth / equation.width : 1;
      if (scale < 1) {
        for (const item of equation.items) {
          if (item.type === "text" || item.type === "rect" || item.type === "image") { item.x *= scale; item.y *= scale; if (item.type === "text") item.size *= scale; else { item.width *= scale; item.height *= scale; } }
          else { item.x1 *= scale; item.x2 *= scale; item.y1 *= scale; item.y2 *= scale; item.width *= scale; }
        }
        equation.width *= scale; equation.height *= scale;
      }
      const offsetX = (contentWidth - equation.width) / 2;
      for (const item of equation.items) {
        if (item.type === "text" || item.type === "rect" || item.type === "image") item.x += offsetX;
        else { item.x1 += offsetX; item.x2 += offsetX; }
      }
      compiled.push({ type: block.type, atoms: [{ height: equation.height, items: equation.items }], before: spacing.math[0], after: spacing.math[1] });
    } else if (block.type === "image") {
      if (!block.asset) continue;
      const intrinsicWidth = block.asset.width * 72 / options.imageDpi, intrinsicHeight = block.asset.height * 72 / options.imageDpi;
      const nextBlock = blocks[sourceIndex + 1];
      const shouldFloat = options.imageFlow === "smart" && intrinsicHeight > intrinsicWidth * 1.1 && nextBlock?.type === "paragraph";
      const captionReserve = options.showImageAltAsCaption && block.alt ? em * (options.imageCaptionGap + 0.88 * 1.12) : 0;
      const usablePageHeight = pageHeight - options.marginTop - options.marginBottom;
      const usableHeight = Math.max(em * 6, usablePageHeight * options.imageMaxHeightRatio - captionReserve);
      const maximumWidth = shouldFloat ? contentWidth * options.imageFloatWidthRatio : contentWidth;
      const scale = Math.min(maximumWidth / intrinsicWidth, usableHeight / intrinsicHeight, options.imageAllowUpscale ? Infinity : 1);
      const width = intrinsicWidth * scale, height = intrinsicHeight * scale;
      const floatSide = options.imageFloatSide === "alternate" ? (floatedFigures++ % 2 ? "left" : "right") : options.imageFloatSide;
      const x = shouldFloat ? (floatSide === "left" ? 0 : contentWidth - width)
        : options.imageAlign === "left" ? 0 : options.imageAlign === "right" ? contentWidth - width : (contentWidth - width) / 2;
      const atoms: Atom[] = [{ height, items: [{ type: "image", x, y: 0, width, height, asset: block.asset }] }];
      if (options.showImageAltAsCaption && block.alt) {
        const captionSize = em * 0.88, captionLine = captionSize * 1.12;
        const captionAtoms = textAtoms([{ text: block.alt, italic: true }], captionSize, width, captionLine, { x, family: options.bodyFont });
        centerAtoms(captionAtoms, x, width);
        if (captionAtoms.length) captionAtoms[0]!.height += options.imageCaptionGap * em;
        for (const atom of captionAtoms) for (const item of atom.items) if (item.type === "text") { item.y += options.imageCaptionGap * em; item.color = MUTED; }
        atoms.push(...captionAtoms);
      }
      let offset = 0; const figureItems: DrawItem[] = [];
      for (const atom of atoms) {
        for (const item of atom.items) {
          const copy = { ...item } as DrawItem;
          if (copy.type === "text" || copy.type === "rect" || copy.type === "image") copy.y += offset;
          else { copy.y1 += offset; copy.y2 += offset; }
          figureItems.push(copy);
        }
        offset += atom.height;
      }
      if (shouldFloat && nextBlock?.type === "paragraph") {
        const gap = options.imageFloatGap * em, textWidth = contentWidth - width - gap;
        if (textWidth >= contentWidth * 0.38) {
          const textX = floatSide === "left" ? width + gap : 0;
          const paragraphAtoms = textAtoms(nextBlock.runs, em, textWidth, lineHeight, { x: textX, justify: options.justify });
          let textOffset = 0;
          for (const atom of paragraphAtoms) {
            for (const item of atom.items) {
              const copy = { ...item } as DrawItem;
              if (copy.type === "text" || copy.type === "rect" || copy.type === "image") copy.y += textOffset;
              else { copy.y1 += textOffset; copy.y2 += textOffset; }
              figureItems.push(copy);
            }
            textOffset += atom.height;
          }
          const internalBlank = height - textOffset;
          if (options.blankSpaceDecoration === "dot-grid" && internalBlank >= 3 * em) {
            const fieldTop = textOffset + 1.25 * em, fieldBottom = height;
            figureItems.unshift(...grayDotGrid(textX, fieldTop, textWidth, fieldBottom - fieldTop, options.blankSpaceDecorationSeed ^ 0x51f15e ^ sourceIndex));
          }
          compiled.push({ type: block.type, atoms: [{ height: Math.max(offset, textOffset), items: figureItems }], before: spacing.image[0], after: spacing.paragraph[1], flow: "float" });
          sourceIndex++;
          continue;
        }
      }
      compiled.push({ type: block.type, atoms: [{ height: offset, items: figureItems }], before: spacing.image[0], after: spacing.image[1] });
    } else if (block.type === "table") {
      const columns = block.header.length, pad = metrics.cellPad, allRows = [block.header, ...block.rows];
      if (!columns) continue;
      const natural = new Array<number>(columns).fill(em * 2);
      for (const row of allRows) row.forEach((cell, column) => { if (column < columns) natural[column] = Math.max(natural[column]!, cell.reduce((w, run) => w + measure(run.text, em * 0.95, run), 0) + 2 * pad); });
      const total = natural.reduce((a, b) => a + b, 0), widths = natural.map(w => total > contentWidth ? w * contentWidth / total : w + (contentWidth - total) / columns);
      const atoms = allRows.map((row, rowIndex): Atom => {
        const size = em * 0.95, cellLines = row.map((cell, column) => wrap(rowIndex ? cell : cell.map(r => ({ ...r, bold: true })), size, widths[column]! - 2 * pad));
        const rows = Math.max(1, ...cellLines.map(lines => lines.length)), height = rows * size * 1.35 + 1.6 * pad;
        const items: DrawItem[] = [];
        const gridWidth = 0.6;
        if (rowIndex && rowIndex % 2 === 0) items.push({ type: "rect", x: gridWidth / 2, y: gridWidth / 2,
          width: contentWidth - gridWidth, height: height - gridWidth, color: [0.965, 0.973, 0.98] });
        let x = 0;
        for (let column = 0; column <= columns; column++) { items.push({ type: "line", x1: x, y1: 0, x2: x, y2: height, width: gridWidth, color: BORDER }); x += widths[column] ?? 0; }
        items.push({ type: "line", x1: 0, y1: height, x2: contentWidth, y2: height, width: gridWidth, color: BORDER });
        if (!rowIndex) items.push({ type: "line", x1: 0, y1: 0, x2: contentWidth, y2: 0, width: gridWidth, color: BORDER });
        const textBlockHeight = size + (rows - 1) * size * 1.35;
        const textTop = (height - textBlockHeight) / 2;
        row.forEach((_, column) => cellLines[column]?.forEach((words, line) => items.push(...makeLine(words,
          widths.slice(0, column).reduce((a, b) => a + b, 0) + pad, textTop + line * size * 1.35, size))));
        return { height, items };
      });
      compiled.push({ type: block.type, atoms, before: spacing.table[0], after: spacing.table[1], splitMin: 2 });
    }
  }

  const pages: DrawItem[][] = [];
  let page: DrawItem[] = [], y = options.marginTop;
  const bottom = pageHeight - options.marginBottom, fresh = () => y === options.marginTop;
  const newPage = () => {
    pages.push(page);
    page = []; y = options.marginTop;
  };
  const place = (atom: Atom) => {
    for (const item of atom.items) {
      const copy = { ...item } as DrawItem;
      if (copy.type === "text" || copy.type === "rect" || copy.type === "image") { copy.x += contentX; copy.y += y; }
      else { copy.x1 += contentX; copy.x2 += contentX; copy.y1 += y; copy.y2 += y; }
      page.push(copy);
    }
    y += atom.height;
  };

  for (let blockIndex = 0; blockIndex < compiled.length; blockIndex++) {
    const block = compiled[blockIndex]!, previous = compiled[blockIndex - 1], next = compiled[blockIndex + 1];
    let gap = fresh() ? 0 : gapBetween(previous, block);
    if (block.type === "rule" && (fresh() || y + gap + (block.atoms[0]?.height ?? 0) + (next ? gapBetween(block, next) + (next.atoms[0]?.height ?? 0) : 0) > bottom)) { if (!fresh()) newPage(); continue; }
    const firstCount = Math.min(block.atoms.length, block.splitMin ?? 1);
    let need = gap + block.atoms.slice(0, firstCount).reduce((sum, atom) => sum + atom.height, 0);
    if (block.keep && next) {
      let keepIndex = blockIndex;
      while (compiled[keepIndex]?.keep && compiled[keepIndex + 1]) {
        const current = compiled[keepIndex]!, following = compiled[keepIndex + 1]!;
        const count = following.keep ? following.atoms.length : Math.min(following.atoms.length, following.splitMin ?? 1);
        need += gapBetween(current, following) + following.atoms.slice(0, count).reduce((sum, atom) => sum + atom.height, 0);
        keepIndex++;
      }
    }
    if (y + need > bottom && !fresh()) { newPage(); gap = 0; }
    y += gap;

    let fragmentStart = y, mark = page.length;
    if (block.decoration === "code") y += metrics.codePad;
    const closeDecoration = () => {
      if (!block.decoration) return;
      const end = y + (block.decoration === "code" ? metrics.codePad : 0), fragment = page.splice(mark);
      if (block.decoration === "code") {
        page.push({ type: "rect", x: contentX, y: fragmentStart, width: contentWidth, height: end - fragmentStart, color: [0.955, 0.96, 0.97] });
        page.push({ type: "line", x1: contentX, y1: fragmentStart, x2: contentX + contentWidth, y2: fragmentStart, width: 0.5, color: [0.88, 0.89, 0.91] });
        page.push({ type: "line", x1: contentX, y1: end, x2: contentX + contentWidth, y2: end, width: 0.5, color: [0.88, 0.89, 0.91] });
      } else page.push({ type: "rect", x: contentX, y: fragmentStart, width: metrics.quoteBar, height: end - fragmentStart, color: BORDER });
      page.push(...fragment); y = end;
    };
    for (let atomIndex = 0; atomIndex < block.atoms.length; atomIndex++) {
      const atom = block.atoms[atomIndex]!;
      let shouldBreak = y + atom.height > bottom;
      if (!shouldBreak && block.splitMin === 2 && block.atoms.length - atomIndex === 2 && y + atom.height + block.atoms[atomIndex + 1]!.height > bottom) shouldBreak = true;
      if (shouldBreak && !fresh()) {
        closeDecoration(); newPage(); mark = page.length; fragmentStart = y;
        if (block.decoration === "code") y += metrics.codePad;
      }
      place(atom);
    }
    closeDecoration();
  }
  if (page.length || !pages.length) pages.push(page);
  if (options.blankSpaceDecoration === "dot-grid") {
    const itemBottom = (item: DrawItem) => item.type === "text" ? item.y + item.size
      : item.type === "rect" || item.type === "image" ? item.y + item.height
      : Math.max(item.y1, item.y2) + item.width / 2;
    pages.forEach((pageItems, pageIndex) => {
      const isDot = (item: DrawItem) => item.type === "rect" && item.width <= em * 0.2 && item.height <= em * 0.2;
      const contentBottom = pageItems.reduce((maximum, item) => isDot(item) ? maximum : Math.max(maximum, itemBottom(item)), options.marginTop);
      const dotBottom = pageItems.reduce((maximum, item) => isDot(item) ? Math.max(maximum, itemBottom(item)) : maximum, 0);
      const joinsExistingField = dotBottom >= contentBottom - 0.25 * em;
      const blankTop = joinsExistingField ? Math.max(contentBottom, dotBottom) : contentBottom + 1.5 * em;
      const available = bottom - blankTop;
      if (available < 2.75 * em) return;
      const fieldHeight = available, fieldTop = blankTop;
      pageItems.unshift(...grayDotGrid(contentX, fieldTop, contentWidth, fieldHeight, options.blankSpaceDecorationSeed ^ 0xd075eed ^ pageIndex));
    });
  }
  return { pages, pageWidth, pageHeight };
}

export { DEFAULT_OPTIONS };

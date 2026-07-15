import type { RenderOptions } from "./types.js";

export const PAGE_SIZES = {
  letter: [612, 792],
  a4: [595.28, 841.89],
} as const;

export const DEFAULT_OPTIONS: RenderOptions = {
  pageSize: "letter",
  marginX: 60,
  marginTop: 60,
  marginBottom: 60,
  contentWidthRatio: 1,
  bodyFont: "sans",
  headingFont: "sans",
  monoFont: "mono",
  boldHeadings: true,
  justify: false,
  indentStyle: "off",
  smallCapsH2: false,
  fontSize: 11,
  bodyLetterSpacing: -0.02,
  headingLetterSpacing: 0,
  codeLetterSpacing: 0,
  lineHeight: 1.45,
  paragraphSpace: 1,
  blockGap: 1,
  h1Scale: 2,
  h2Scale: 1.5,
  h3Scale: 1.25,
  headingBefore: 1.35,
  headingAfter: 0.5,
  keepWithNext: true,
  attachTight: 0.35,
  listIndent: 1.75,
  listItemGap: 0.25,
  codeScale: 0.86,
  codeLineHeight: 1.3,
  codePad: 0.65,
  quoteIndent: 0.8,
  cellPad: 0.55,
  ruleSpace: 1.5,
  imageDpi: 96,
  imageAllowUpscale: false,
  imageMaxHeightRatio: 0.62,
  imageFlow: "smart",
  imageFloatWidthRatio: 0.42,
  imageFloatGap: 1.5,
  imageFloatSide: "right",
  imageAlign: "left",
  imageGap: 0.8,
  imageCaptionGap: 0.4,
  showImageAltAsCaption: true,
  blankSpaceDecoration: "none",
  blankSpaceDecorationSeed: 1,
};

export function resolveOptions(options: Partial<RenderOptions> = {}): RenderOptions {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  if (options.letterSpacing !== undefined) {
    if (options.bodyLetterSpacing === undefined) resolved.bodyLetterSpacing = options.letterSpacing;
    if (options.headingLetterSpacing === undefined) resolved.headingLetterSpacing = options.letterSpacing;
    if (options.codeLetterSpacing === undefined) resolved.codeLetterSpacing = options.letterSpacing;
  }
  return resolved;
}

export function typeMetrics(em: number, options: RenderOptions) {
  return {
    listIndent: options.listIndent * em,
    codePad: options.codePad * em,
    codeSidePad: (options.codePad + 0.25) * em,
    quoteIndent: options.quoteIndent * em,
    quoteBar: 0.25 * em,
    cellPad: options.cellPad * em,
    h1RuleGap: 0.55 * em,
  };
}

export const HEADING_LINE_HEIGHT = [1.15, 1.2, 1.25] as const;

export type Alignment = "left" | "center" | "right";

export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
  /** TeX source for inline mathematics. */
  math?: boolean;
  mathSource?: string;
  mathAsset?: ImageAsset;
}

export interface ParagraphBlock { type: "paragraph"; runs: InlineRun[] }
export interface HeadingBlock { type: "heading"; level: 1 | 2 | 3; runs: InlineRun[] }
export interface RuleBlock { type: "rule" }
export interface CodeBlock { type: "code"; lang: string; lines: string[] }
export interface QuoteBlock { type: "quote"; children: Block[] }
export interface ListItem { depth: number; ordered: boolean; runs: InlineRun[] }
export interface ListBlock { type: "list"; ordered: boolean; items: ListItem[] }
export interface TableBlock {
  type: "table";
  header: InlineRun[][];
  rows: InlineRun[][][];
  align: Alignment[];
}

export type ImageFormat = "jpeg" | "png";

export interface ImageAsset {
  id: string;
  source: string;
  format: ImageFormat;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  bytes: Uint8Array;
  /** PDF-ready 8-bit pixels for PNG assets. */
  pixels?: Uint8Array;
  channels?: 1 | 2 | 3 | 4;
  /** Raster density multiplier; layout dimensions are divided by this value. */
  pixelRatio?: number;
  /** Natural dimensions in em units for MathJax-generated assets. */
  widthEm?: number;
  heightEm?: number;
  /** Original self-contained MathJax SVG, used by HTML output without rasterization. */
  vectorSvg?: string;
  /** Fraction of the image height above the mathematical baseline. */
  baselineRatio?: number;
}

export interface ImageBlock {
  type: "image";
  source: string;
  alt: string;
  title?: string;
  asset?: ImageAsset;
}

export interface MathBlock { type: "math"; source: string; asset?: ImageAsset }

export type Block =
  | ParagraphBlock | HeadingBlock | RuleBlock | CodeBlock | QuoteBlock
  | ListBlock | TableBlock | ImageBlock | MathBlock;

export interface MarkdownDocument {
  blocks: Block[];
  source: string;
}

export type FontSlot = "regular" | "bold" | "italic" | "bolditalic";

export interface ParsedFont {
  bytes: Uint8Array;
  upem: number;
  numGlyphs: number;
  cmap: Map<number, number>;
  advances: Uint16Array;
  bbox: [number, number, number, number];
  ascent: number;
  descent: number;
  capHeight: number;
  italicAngle: number;
  family: string;
  subfamily: string;
  postscriptName: string;
}

export interface FontFamily {
  id: string;
  label: string;
  cssFamily: string;
  styles: Partial<Record<FontSlot, ParsedFont>>;
}

export type Color = readonly [number, number, number];

export interface TextItem {
  type: "text";
  x: number; y: number; size: number; text: string;
  family: string; bold?: boolean; italic?: boolean; mono?: boolean;
  tracking?: number; color: Color; link?: string;
}
export interface RectItem { type: "rect"; x: number; y: number; width: number; height: number; color: Color }
export interface LineItem { type: "line"; x1: number; y1: number; x2: number; y2: number; width: number; color: Color }
export interface ImageItem { type: "image"; x: number; y: number; width: number; height: number; asset: ImageAsset }
export type DrawItem = TextItem | RectItem | LineItem | ImageItem;

export interface LayoutResult {
  pages: DrawItem[][];
  pageWidth: number;
  pageHeight: number;
}

export interface RenderOptions {
  pageSize: "letter" | "a4";
  marginX: number;
  marginTop: number;
  marginBottom: number;
  /** Fraction of the width inside the page margins used by the centered content column. */
  contentWidthRatio: number;
  bodyFont: string;
  headingFont: string;
  monoFont: string;
  boldHeadings: boolean;
  justify: boolean;
  indentStyle: "all" | "book" | "off";
  smallCapsH2: boolean;
  fontSize: number;
  /** Legacy global tracking alias. Prefer the role-specific settings. */
  letterSpacing?: number;
  /** Body-text letter spacing in em units. */
  bodyLetterSpacing: number;
  /** Heading letter spacing in em units. */
  headingLetterSpacing: number;
  /** Inline and fenced-code letter spacing in em units. */
  codeLetterSpacing: number;
  lineHeight: number;
  paragraphSpace: number;
  blockGap: number;
  h1Scale: number;
  h2Scale: number;
  h3Scale: number;
  headingBefore: number;
  headingAfter: number;
  keepWithNext: boolean;
  attachTight: number;
  listIndent: number;
  listItemGap: number;
  codeScale: number;
  codeLineHeight: number;
  codePad: number;
  quoteIndent: number;
  cellPad: number;
  ruleSpace: number;
  imageDpi: number;
  imageAllowUpscale: boolean;
  /** Maximum fraction of the usable page height occupied by an inline figure. Set to 1 for full-page figures. */
  imageMaxHeightRatio: number;
  imageFlow: "smart" | "block";
  imageFloatWidthRatio: number;
  imageFloatGap: number;
  imageFloatSide: "left" | "right" | "alternate";
  imageAlign: "left" | "center" | "right";
  imageGap: number;
  imageCaptionGap: number;
  showImageAltAsCaption: boolean;
  blankSpaceDecoration: "none" | "dot-grid";
  blankSpaceDecorationSeed: number;
}

export type ImageResolver = (source: string) => Promise<ImageAsset>;

export interface RendererOptions {
  config?: Partial<RenderOptions>;
  fonts?: FontFamily[];
  imageResolver?: ImageResolver;
}

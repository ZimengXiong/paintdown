# Paintdown

Markdown, typeset.

Paintdown is a deterministic Markdown layout engine and native PDF writer for TypeScript. It parses Markdown into a typed document model, composes a reusable display list, and writes PDF bytes directly—without Chromium, HTML printing, or a remote service.

[Open the live workbench](https://zimengxiong.github.io/paintdown/)

## Why Paintdown

- Native, deterministic PDF output
- GitHub Flavored Markdown, tables, links, quotes, and lists
- MathJax 4 for inline and display LaTeX
- Syntax-highlighted fenced code
- Responsive images with block and editorial float layouts
- Real font measurement and embedded TrueType fonts
- Widow/orphan-aware pagination and heading keep rules
- Smart chronological figure flow
- Matching browser preview, HTML export, and PDF geometry
- No uploads; the browser demo works entirely on-device
- Local folder picker and folder drag-and-drop with relative image resolution

The static workbench loads `README.md`, `index.md`, or the first Markdown file from a selected folder. Relative PNG and JPEG references are resolved from that local folder in memory; nothing is sent to a server.

Short section introductions stay with their figures. Chronologically valid headings, paragraphs, lists, and display math continue beside a portrait until the image ends. Figure flow never changes the computed image dimensions.

## Quick start

Paintdown is currently published from GitHub while the API settles.

```sh
git clone https://github.com/ZimengXiong/paintdown.git
cd paintdown
npm ci
npm run build
```

```ts
import { createFetchImageResolver, createRenderer } from "paintdown";
import { loadInter } from "paintdown/inter";

const inter = loadInter();
const renderer = createRenderer({
  fonts: [inter.body, inter.display],
  config: {
    bodyFont: inter.body.id,
    headingFont: inter.display.id,
    fontSize: 11,
  },
  imageResolver: createFetchImageResolver(fetch, import.meta.url),
});

const pdf = await renderer.pdf("# Hello\n\nA carefully typeset document.");
const html = await renderer.html("# Hello\n\nThe same Markdown, for the web.");
```

## API

The main entry point exports the high-level renderer and the lower-level parser, layout, image, HTML, PDF, and font primitives.

```ts
const renderer = createRenderer({
  fonts,
  config,
  imageResolver,
});

renderer.parse(markdown);       // synchronous typed document model
await renderer.prepare(markdown); // resolved images and MathJax assets
await renderer.layout(markdown);  // paginated display list
await renderer.html(markdown);    // self-contained HTML
await renderer.pdf(markdown);     // Uint8Array
```

Additional entry points:

- `paintdown/browser` — browser font registration, preview, and downloads
- `paintdown/inter` — compact Inter and Inter Display family bundle
- `paintdown/bundled-fonts` — the complete optional font collection

## Typography

Body, heading, and code families are independently selectable. Paintdown ships optional sans, serif, monospace, and dotted display faces, including Inter, Source Sans 3, Source Serif 4, IBM Plex, JetBrains Mono, Fira Code, Geist Mono, Cascadia Mono, Space Mono, and Doto.

Role-specific `bodyLetterSpacing`, `headingLetterSpacing`, and `codeLetterSpacing` values use em units. `contentWidthRatio` controls the centered measure inside the page margins. The legacy `letterSpacing` option remains a global alias.

Commercial fonts such as Berkeley Mono are intentionally not redistributed. Register licensed TTF bytes with `createFontFamily`, or use the workbench’s local font importer.

## Images and math

PNG and JPEG assets preserve their intrinsic aspect ratio and do not upscale by default. Landscape artwork uses the content measure; portrait artwork can float beside prose with a measured gutter. Oversized figures are capped to the usable page height.

Use `$E = mc^2$` for inline math and `$$ ... $$` on separate lines for display math. The asynchronous renderer uses MathJax’s self-contained SVG in HTML and a print-density raster in the native display list and PDF.

## Development

```sh
npm run typecheck
npm test
npm run build
npm run check
npm run verify:pdf
```

`npm run generate:art` regenerates the seeded procedural image fixtures used by the demo.

## Status

Paintdown is pre-1.0. The public API is typed and tested, but option names and pagination behavior may still evolve before the first stable release.

## License

MIT © 2026 Zimeng Xiong. Bundled fonts retain their respective license files.

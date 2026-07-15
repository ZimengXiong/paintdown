import { createFetchImageResolver, createRenderer, decodeImage, DEFAULT_OPTIONS } from "../src/index.js";
import { createFontFamily, fontSlot, parseTrueType } from "../src/fonts.js";
import { downloadBytes, registerBrowserFonts, renderPreview } from "../src/browser.js";
import { loadInter } from "../src/inter.js";
import type { FontSlot, RenderOptions } from "../src/types.js";

const proceduralArt = new URLSearchParams(location.search).get("art") === "procedural";
const art = (name: "portrait" | "wide" | "tall") => `./demo/images/${proceduralArt ? "procedural-" : ""}${name}.png`;
const sample = `# Paintdown sample

## Responsive image sizing

Images retain their proportions and do not upscale by default. Portrait images can float beside following prose.

![A matte green, teal, and clay portrait composition](${art("portrait")})

This paragraph wraps beside the portrait. A measured gutter separates the text and image. The float ends before the next structural block.

### Measure and rhythm

Content width, line height, and paragraph spacing are independent. A narrower measure creates more line breaks; greater line height adds vertical space without changing the type size.

Headings stay with the first lines of the block that follows them.

### Landscape figures

Landscape images remain in block flow when floating would leave a narrow text column.

![A matte indigo, violet, and coral panoramic composition](${art("wide")})

### Page flow

Paragraphs split only when both fragments meet the minimum line count. Headings move with following content instead of sitting alone at a page edge.

Block images remain in document order. Portrait floats clear before headings, lists, tables, and code.

---

## Oversized figures

Images taller than the usable page area are scaled to fit and aligned to the top.

![A tall matte ember, rose, and aubergine composition](${art("tall")})

The height limit follows the usable page area, so page size and margins affect the figure cap. The aspect ratio does not change.

## Markdown details

- Lists use consistent spacing and hanging indents
  - Nested items retain their level
- Headings use the selected display face
- Inline \`code\` uses the selected code face
- [Links remain continuous](https://github.com/ZimengXiong/paintdown)

> Quotes sit beside a left rule.

### LaTeX mathematics

Inline mathematics follows the prose baseline: $E = mc^2$ and $a_n = a_1 r^{n-1}$. Display mathematics is centered.

$$
\\int_0^\\infty e^{-x^2} \\, dx = \\frac{\\sqrt{\\pi}}{2}
$$

\`\`\`ts
const renderer = createRenderer({
  config: { fontSize: 11, boldHeadings: true },
  imageResolver: createFetchImageResolver(fetch, document.baseURI),
});
const pdf = await renderer.pdf(markdown);
\`\`\`

| Feature | Default | Behavior |
| --- | --- | --- |
| Wide image | max width | No distortion or upscaling |
| Portrait image | smart float | Following prose wraps beside it |
| Very tall image | smart float | Capped height with measured gutter |
`;

const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
const preview = document.querySelector<HTMLElement>("#previewPane")!;
const status = document.querySelector<HTMLElement>("#status")!;
const inter = loadInter();
const decorationSeed = Math.floor(Math.random() * 0x100000000);
const localFiles = new Map<string, File>();
let markdownPath = "";
const fetchImage = createFetchImageResolver(fetch, document.baseURI);
const cleanPath = (path: string) => path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
const localImagePath = (source: string) => {
  const plain = source.split(/[?#]/, 1)[0]!;
  try { return cleanPath(decodeURIComponent(new URL(plain, `https://paintdown.local/${markdownPath}`).pathname)); }
  catch { return cleanPath(plain); }
};
const demoDefaults: RenderOptions = { ...DEFAULT_OPTIONS,
  bodyFont: inter.body.id, headingFont: inter.display.id, boldHeadings: true,
  marginX: 60, marginTop: 60, marginBottom: 60,
  blankSpaceDecoration: "dot-grid", blankSpaceDecorationSeed: decorationSeed,
};
const demoConfig: RenderOptions = { ...demoDefaults };
await registerBrowserFonts([inter.body, inter.display]);
const renderer = createRenderer({
  fonts: [inter.body, inter.display],
  config: demoConfig,
  imageResolver: async source => {
    const file = localFiles.get(localImagePath(source));
    if (!file) return fetchImage(source);
    return decodeImage(new Uint8Array(await file.arrayBuffer()), source, file.type || undefined);
  },
});
editor.value = sample;

let sequence = 0;
async function update() {
  const current = ++sequence; status.textContent = "Rendering…";
  try {
    const layout = await renderer.layout(editor.value);
    if (current !== sequence) return;
    renderPreview(preview, layout, renderer.fonts.values());
    status.textContent = `${layout.pages.length} page${layout.pages.length === 1 ? "" : "s"}`;
  } catch (error) { if (current === sequence) status.textContent = error instanceof Error ? error.message : String(error); }
}

let settingsTimer = 0;
function scheduleUpdate(delay = 55) {
  clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(() => { void update(); }, delay);
}

type DroppedEntry = {
  isFile: boolean; isDirectory: boolean; name: string; fullPath: string;
  file?: (success: (file: File) => void, failure?: (error: DOMException) => void) => void;
  createReader?: () => { readEntries: (success: (entries: DroppedEntry[]) => void, failure?: (error: DOMException) => void) => void };
};

async function filesFromEntry(entry: DroppedEntry): Promise<{ path: string; file: File }[]> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
    return [{ path: cleanPath(entry.fullPath || file.name), file }];
  }
  if (!entry.isDirectory || !entry.createReader) return [];
  const reader = entry.createReader(), children: DroppedEntry[] = [];
  while (true) {
    const batch = await new Promise<DroppedEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    children.push(...batch);
  }
  return (await Promise.all(children.map(filesFromEntry))).flat();
}

async function openLocalFolder(entries: { path: string; file: File }[]) {
  if (!entries.length) return;
  localFiles.clear();
  for (const entry of entries) localFiles.set(cleanPath(entry.path), entry.file);
  const markdown = entries.filter(entry => /\.(?:md|markdown)$/i.test(entry.path)).sort((a, b) => {
    const rank = (path: string) => /(^|\/)readme\.md$/i.test(path) ? 0 : /(^|\/)index\.md$/i.test(path) ? 1 : 2;
    return rank(a.path) - rank(b.path) || a.path.localeCompare(b.path);
  })[0];
  if (markdown) {
    markdownPath = cleanPath(markdown.path);
    editor.value = await markdown.file.text();
    status.textContent = `Opened ${markdownPath}`;
  } else {
    const root = cleanPath(entries[0]!.path).split("/")[0] ?? "";
    markdownPath = root ? `${root}/document.md` : "document.md";
    status.textContent = `${entries.length} local asset${entries.length === 1 ? "" : "s"} attached`;
  }
  scheduleUpdate(0);
}

const folderInput = document.querySelector<HTMLInputElement>("#folderInput")!;
document.querySelector("#openFolderBtn")!.addEventListener("click", () => folderInput.click());
folderInput.addEventListener("change", () => {
  const entries = [...folderInput.files ?? []].map(file => ({ path: file.webkitRelativePath || file.name, file }));
  void openLocalFolder(entries).finally(() => { folderInput.value = ""; });
});

let dragDepth = 0;
window.addEventListener("dragenter", event => {
  if (![...(event.dataTransfer?.types ?? [])].includes("Files")) return;
  event.preventDefault(); dragDepth++; document.body.classList.add("folder-dragging");
});
window.addEventListener("dragover", event => { if ([...(event.dataTransfer?.types ?? [])].includes("Files")) event.preventDefault(); });
window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("folder-dragging"); } });
window.addEventListener("drop", event => { void (async () => {
  if (!event.dataTransfer || ![...event.dataTransfer.types].includes("Files")) return;
  event.preventDefault(); dragDepth = 0; document.body.classList.remove("folder-dragging");
  const roots = [...event.dataTransfer.items]
    .map(item => (item as DataTransferItem & { webkitGetAsEntry?: () => DroppedEntry | null }).webkitGetAsEntry?.())
    .filter((entry): entry is DroppedEntry => !!entry);
  const entries = roots.length ? (await Promise.all(roots.map(filesFromEntry))).flat()
    : [...event.dataTransfer.files].map(file => ({ path: file.webkitRelativePath || file.name, file }));
  await openLocalFolder(entries);
})().catch(error => { status.textContent = error instanceof Error ? error.message : String(error); }); });

const settings = document.querySelector<HTMLElement>("#settings")!;
const settingsButton = document.querySelector<HTMLButtonElement>("#settingsBtn")!;
const configControls = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-config]")];
const marginControl = document.querySelector<HTMLInputElement>("[data-margin]")!;
const mutableConfig = demoConfig as unknown as Record<string, unknown>;
const fontLoaders: Record<string, () => Promise<import("../src/types.js").FontFamily>> = {
  "source-sans-3": async () => (await import("../src/font-families/source-sans-3.js")).loadSourceSans3(),
  "source-serif-4": async () => (await import("../src/font-families/source-serif-4.js")).loadSourceSerif4(),
  "fira-sans": async () => (await import("../src/font-families/fira-sans.js")).loadFiraSans(),
  "atkinson-hyperlegible": async () => (await import("../src/font-families/atkinson-hyperlegible.js")).loadAtkinsonHyperlegible(),
  "alegreya-sans": async () => (await import("../src/font-families/alegreya-sans.js")).loadAlegreyaSans(),
  "ibm-plex-serif": async () => (await import("../src/font-families/ibm-plex-serif.js")).loadIbmPlexSerif(),
  "spectral": async () => (await import("../src/font-families/spectral.js")).loadSpectral(),
  "crimson-text": async () => (await import("../src/font-families/crimson-text.js")).loadCrimsonText(),
  "gentium-book-plus": async () => (await import("../src/font-families/gentium-book-plus.js")).loadGentiumBookPlus(),
  "source-code-pro": async () => (await import("../src/font-families/source-code-pro.js")).loadSourceCodePro(),
  "ibm-plex-mono": async () => (await import("../src/font-families/ibm-plex-mono.js")).loadIbmPlexMono(),
  "space-mono": async () => (await import("../src/font-families/space-mono.js")).loadSpaceMono(),
  "doto": async () => (await import("../src/font-families/doto.js")).loadDoto(),
  "jetbrains-mono": async () => (await import("../src/font-families/jetbrains-mono.js")).loadJetBrainsMono(),
  "fira-code": async () => (await import("../src/font-families/fira-code.js")).loadFiraCode(),
  "roboto-mono": async () => (await import("../src/font-families/roboto-mono.js")).loadRobotoMono(),
  "geist-mono": async () => (await import("../src/font-families/geist-mono.js")).loadGeistMono(),
  "cascadia-mono": async () => (await import("../src/font-families/cascadia-mono.js")).loadCascadiaMono(),
};
const pendingFonts = new Map<string, Promise<void>>();
async function ensureFont(id: string) {
  if (renderer.fonts.get(id) || !fontLoaders[id]) return;
  let pending = pendingFonts.get(id);
  if (!pending) {
    pending = fontLoaders[id]!().then(async family => { renderer.fonts.add(family); await registerBrowserFonts([family]); });
    pendingFonts.set(id, pending);
  }
  await pending;
}

function addFontOption(id: string, label: string) {
  for (const select of document.querySelectorAll<HTMLSelectElement>("select[data-config='bodyFont'],select[data-config='headingFont'],select[data-config='monoFont']")) {
    let group = [...select.children].find(child => child instanceof HTMLOptGroupElement && child.label === "Custom / licensed") as HTMLOptGroupElement | undefined;
    if (!group) { group = document.createElement("optgroup"); group.label = "Custom / licensed"; select.append(group); }
    if (![...group.options].some(option => option.value === id)) group.append(new Option(label, id));
  }
}

document.querySelector<HTMLInputElement>("#fontUpload")!.addEventListener("change", event => { void (async () => {
  const files = [...(event.currentTarget as HTMLInputElement).files ?? []];
  const grouped = new Map<string, { label: string; styles: Partial<Record<FontSlot, Uint8Array>> }>();
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer()), parsed = parseTrueType(bytes);
    const key = parsed.family.toLowerCase();
    const group = grouped.get(key) ?? { label: parsed.family, styles: {} };
    group.styles[fontSlot(parsed.subfamily)] = bytes; grouped.set(key, group);
  }
  for (const [key, group] of grouped) {
    const id = `custom-${key.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    const family = createFontFamily(group.styles, id);
    renderer.fonts.add(family); await registerBrowserFonts([family]); addFontOption(id, group.label);
  }
  status.textContent = grouped.size ? `${grouped.size} custom font${grouped.size === 1 ? "" : "s"} added` : "No TTF fonts selected";
})(); });

function formatSetting(value: unknown): string {
  return typeof value === "number" ? (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")) : String(value ?? "");
}

function syncSettings() {
  for (const control of configControls) {
    const key = control.dataset.config!, value = mutableConfig[key];
    if (control instanceof HTMLInputElement && control.type === "checkbox") control.checked = Boolean(value);
    else control.value = String(value);
    const output = control.closest(".range-wrap")?.querySelector("output");
    if (output) output.textContent = control.dataset.format === "percent" ? `${Math.round(Number(value) * 100)}%` : formatSetting(value);
  }
  marginControl.value = String(demoConfig.marginX);
  marginControl.closest(".range-wrap")!.querySelector("output")!.textContent = String(demoConfig.marginX);
}

for (const control of configControls) control.addEventListener("input", () => { void (async () => {
  const key = control.dataset.config!;
  mutableConfig[key] = control instanceof HTMLInputElement && control.type === "checkbox" ? control.checked
    : control instanceof HTMLInputElement && control.type === "range" ? Number(control.value)
    : control.value;
  if (key === "bodyFont" || key === "headingFont" || key === "monoFont") await ensureFont(String(mutableConfig[key]));
  syncSettings(); scheduleUpdate();
})(); });
marginControl.addEventListener("input", () => {
  demoConfig.marginX = demoConfig.marginTop = demoConfig.marginBottom = Number(marginControl.value);
  syncSettings(); scheduleUpdate();
});
const settingsBackdrop = document.querySelector<HTMLElement>("#settingsBackdrop")!;
const setSettingsOpen = (open: boolean) => {
  settings.classList.toggle("open", open); settingsBackdrop.classList.toggle("open", open);
  document.body.classList.toggle("settings-open", open);
  settingsButton.setAttribute("aria-expanded", String(open)); settings.setAttribute("aria-hidden", String(!open));
};
settingsButton.addEventListener("click", () => setSettingsOpen(!settings.classList.contains("open")));
document.querySelector("#settingsClose")!.addEventListener("click", () => setSettingsOpen(false));
settingsBackdrop.addEventListener("click", () => setSettingsOpen(false));
document.querySelector("#resetBtn")!.addEventListener("click", () => {
  for (const key of Object.keys(mutableConfig)) delete mutableConfig[key];
  Object.assign(demoConfig, demoDefaults); syncSettings(); scheduleUpdate(0);
});
document.addEventListener("keydown", event => { if (event.key === "Escape") setSettingsOpen(false); });
const workspace = document.querySelector<HTMLElement>("#workspace")!;
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view-target]")) button.addEventListener("click", () => {
  workspace.dataset.mobileView = button.dataset.viewTarget;
  for (const peer of document.querySelectorAll<HTMLElement>("[data-view-target]")) peer.classList.toggle("active", peer === button);
  if (button.dataset.viewTarget === "preview") void update();
});
syncSettings();

let timer = 0;
editor.addEventListener("input", () => { clearTimeout(timer); timer = window.setTimeout(update, 180); });
window.addEventListener("resize", () => scheduleUpdate(80));
document.querySelector("#pdfBtn")!.addEventListener("click", async () => downloadBytes(await renderer.pdf(editor.value), "document.pdf", "application/pdf"));
document.querySelector("#htmlBtn")!.addEventListener("click", async () => downloadBytes(new TextEncoder().encode(await renderer.html(editor.value)), "document.html", "text/html"));
await update();

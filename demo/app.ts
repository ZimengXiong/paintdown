import { createFetchImageResolver, createRenderer, DEFAULT_OPTIONS } from "../src/index.js";
import { createFontFamily, fontSlot, parseTrueType } from "../src/fonts.js";
import { downloadBytes, registerBrowserFonts, renderPreview } from "../src/browser.js";
import { loadInter } from "../src/inter.js";
import type { FontSlot, RenderOptions } from "../src/types.js";

const proceduralArt = new URLSearchParams(location.search).get("art") === "procedural";
const art = (name: "portrait" | "wide" | "tall") => `./demo/images/${proceduralArt ? "procedural-" : ""}${name}.png`;
const sample = `# Paintdown example

This document exercises typography, pagination, images, math, code, links, and tables using one renderer.

## Responsive image sizing

Images use their intrinsic dimensions at **96 CSS pixels per inch**, preserve their aspect ratio, and never upscale by default. Portrait figures use a smart editorial float when ordinary prose follows them:

![A matte green, teal, and clay portrait composition](${art("portrait")} "Portrait image kept intact when possible")

This paragraph wraps through the column beside the portrait rather than waiting below it. The compositor reserves a measured gutter, keeps every line out of the image box, and clears the float before the next structural block. That is the familiar editorial pattern used for portraits, diagrams, and supporting figures inside longer articles.

### Landscape figures

Wide artwork stays in the ordinary block flow and uses the full content column. Wrapping beside a shallow landscape image would leave a narrow, uncomfortable strip of text, so the smart mode deliberately avoids it.

![A matte indigo, violet, and coral panoramic composition](${art("wide")} "Wide image capped at the content width")

---

## Oversized figures

An image taller than a completely fresh page is scaled down until it fits both the content width and the usable page height. It is top-aligned—vertical centering is for slides, not reading flow.

![A tall matte ember, rose, and aubergine composition](${art("tall")} "Oversized image fitted to the usable page box")

Tall supporting artwork uses the same float treatment when ordinary prose follows it. Landscape artwork remains a full-width block because wrapping beside a shallow, wide image would create an unusably narrow strip of text.

## Markdown details

- List spacing follows the same rhythm above and between items
- Wrapped items retain a hanging indent
- Headings use Inter Display Semibold by default
- [Links render as continuous, accessible runs](https://github.com/ZimengXiong/paintdown)

> Quotes sit close to the left bar and remain vertically balanced inside it.

### LaTeX mathematics

Inline mathematics follows the prose baseline, so $E = mc^2$ and $a_n = a_1 r^{n-1}$ wrap as part of an ordinary sentence. Display mathematics is centered and composed natively:

$$
\\int_0^\\infty e^{-x^2} \\, dx = \\frac{\\sqrt{\\pi}}{2}
$$

Greek symbols, relations, roots, fractions, operators, grouped superscripts, and subscripts use the same layout in the live preview and PDF output.

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
  imageResolver: createFetchImageResolver(fetch, document.baseURI),
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

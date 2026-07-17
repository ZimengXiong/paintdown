import { createFetchImageResolver, createRenderer, decodeImage, DEFAULT_OPTIONS } from "../src/index.js";
import { downloadBytes, registerBrowserFonts, renderPreview } from "../src/browser.js";
import { loadStandardFonts } from "../src/standard-fonts.js";
import type { RenderOptions } from "../src/types.js";
import sample from "../sample.md";

const proceduralArt = new URLSearchParams(location.search).get("art") === "procedural";
const proceduralSample = proceduralArt
  ? sample.replaceAll("./demo/images/", "./demo/images/procedural-")
  : sample;

const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
const preview = document.querySelector<HTMLElement>("#previewPane")!;
const status = document.querySelector<HTMLElement>("#status")!;
const standard = loadStandardFonts();
const decorationSeed = DEFAULT_OPTIONS.blankSpaceDecorationSeed;
const localFiles = new Map<string, File>();
let markdownPath = "";
const fetchImage = createFetchImageResolver(fetch, document.baseURI);
const cleanPath = (path: string) => path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
const localImagePath = (source: string) => {
  const plain = source.split(/[?#]/, 1)[0]!;
  try { return cleanPath(decodeURIComponent(new URL(plain, `https://paintmark.local/${markdownPath}`).pathname)); }
  catch { return cleanPath(plain); }
};
const demoDefaults: RenderOptions = { ...DEFAULT_OPTIONS,
  bodyFont: standard.body.id, headingFont: standard.display.id, monoFont: standard.mono.id, boldHeadings: true,
  marginX: 60, marginTop: 60, marginBottom: 60,
  blankSpaceDecoration: "dot-grid", blankSpaceDecorationSeed: decorationSeed,
};
const demoConfig: RenderOptions = { ...demoDefaults };
const renderer = createRenderer({
  config: demoConfig,
  imageResolver: async source => {
    const file = localFiles.get(localImagePath(source));
    if (!file) return fetchImage(source);
    return decodeImage(new Uint8Array(await file.arrayBuffer()), source, file.type || undefined);
  },
});
await registerBrowserFonts(renderer.fonts.values());
editor.value = proceduralSample;

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

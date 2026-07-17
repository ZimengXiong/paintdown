import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_OPTIONS } from "./config.js";
import { createFontFamily } from "./fonts.js";
import { createFetchImageResolver, decodeImage } from "./images.js";
import { loadInter } from "./inter.js";
import { createRenderer } from "./renderer.js";
import type { ImageResolver, RenderOptions } from "./types.js";

declare const __PAINTDOWN_VERSION__: string;

const enums: Partial<Record<keyof RenderOptions, readonly string[]>> = {
  pageSize: ["letter", "a4"], indentStyle: ["all", "book", "off"], imageFlow: ["smart", "block"],
  imageFloatSide: ["left", "right", "alternate"], imageAlign: ["left", "center", "right"],
  blankSpaceDecoration: ["none", "dot-grid"],
};

const kebab = (value: string) => value.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
const camel = (value: string) => value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
const knownOptions = new Set([...Object.keys(DEFAULT_OPTIONS), "letterSpacing"]);

function coerceOption(name: string, raw: unknown): unknown {
  if (!knownOptions.has(name)) throw new Error(`Unknown tuning option: --${kebab(name)}`);
  const key = name as keyof RenderOptions, fallback = DEFAULT_OPTIONS[key];
  if (typeof fallback === "boolean") {
    if (typeof raw === "boolean") return raw;
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error(`--${kebab(name)} expects true or false`);
  }
  if (typeof fallback === "number" || name === "letterSpacing") {
    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(value)) throw new Error(`--${kebab(name)} expects a number`);
    return value;
  }
  if (typeof raw !== "string") throw new Error(`--${kebab(name)} expects text`);
  const choices = enums[key];
  if (choices && !choices.includes(raw)) throw new Error(`--${kebab(name)} must be one of: ${choices.join(", ")}`);
  return raw;
}

function tuningHelp(): string {
  return [...Object.keys(DEFAULT_OPTIONS), "letterSpacing"].map(name => {
    const value = name === "letterSpacing" ? "unset" : String(DEFAULT_OPTIONS[name as keyof RenderOptions]);
    return `  --${kebab(name)} <value>${" ".repeat(Math.max(1, 34 - name.length))}${value}`;
  }).join("\n");
}

function help(): string {
  return `paintdown ${__PAINTDOWN_VERSION__}

Usage:
  paintdown <input.md> [options]
  cat input.md | paintdown - -o output.pdf

Options:
  -o, --output <file>              Output PDF (defaults beside the input)
  --config <file>                  JSON object containing any tuning options
  --font <file.ttf>                Use a local TrueType font for body and headings
  --help                           Show this help
  --version                        Show the version

Boolean options accept --option, --no-option, or --option true|false.

Tunings (default):
${tuningHelp()}
`;
}

interface ParsedArgs {
  input?: string;
  output?: string;
  configPath?: string;
  fontPath?: string;
  help: boolean;
  version: boolean;
  tuning: Record<string, unknown>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { help: false, version: false, tuning: {} };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    if (argument === "--help" || argument === "-h") { result.help = true; continue; }
    if (argument === "--version" || argument === "-v") { result.version = true; continue; }
    if (argument === "-o" || argument === "--output") { result.output = argv[++index]; if (!result.output) throw new Error(`${argument} needs a file`); continue; }
    if (argument === "--config") { result.configPath = argv[++index]; if (!result.configPath) throw new Error("--config needs a file"); continue; }
    if (argument === "--font") { result.fontPath = argv[++index]; if (!result.fontPath) throw new Error("--font needs a TTF file"); continue; }
    if (argument.startsWith("--")) {
      const [spelling, inline] = argument.slice(2).split(/=(.*)/s, 2);
      const negative = spelling!.startsWith("no-"), name = camel(negative ? spelling!.slice(3) : spelling!);
      if (!knownOptions.has(name)) throw new Error(`Unknown option: --${spelling}`);
      const fallback = DEFAULT_OPTIONS[name as keyof RenderOptions];
      if (negative) {
        if (typeof fallback !== "boolean") throw new Error(`--no-${kebab(name)} is only valid for a boolean option`);
        result.tuning[name] = false; continue;
      }
      if (typeof fallback === "boolean" && inline === undefined && argv[index + 1] !== "true" && argv[index + 1] !== "false") {
        result.tuning[name] = true; continue;
      }
      const raw = inline ?? argv[++index];
      if (raw === undefined) throw new Error(`--${kebab(name)} needs a value`);
      result.tuning[name] = coerceOption(name, raw);
      continue;
    }
    if (argument.startsWith("-") && argument !== "-") throw new Error(`Unknown option: ${argument}`);
    if (result.input) throw new Error("Paintdown accepts one Markdown input at a time");
    result.input = argument;
  }
  return result;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function localImageResolver(baseDirectory: string): ImageResolver {
  const remote = createFetchImageResolver();
  return async source => {
    if (/^(?:https?:|data:)/i.test(source)) return remote(source);
    const path = source.startsWith("file:") ? fileURLToPath(source) : resolve(baseDirectory, decodeURIComponent(source.split(/[?#]/, 1)[0]!));
    return decodeImage(new Uint8Array(await readFile(path)), source);
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(help()); return; }
  if (args.version) { process.stdout.write(`${__PAINTDOWN_VERSION__}\n`); return; }
  if (!args.input) throw new Error("Missing Markdown input. Run paintdown --help for usage.");

  let config: Partial<RenderOptions> = { blankSpaceDecoration: "dot-grid" };
  if (args.configPath) {
    const parsed: unknown = JSON.parse(await readFile(resolve(args.configPath), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The config file must contain a JSON object");
    config = {};
    for (const [name, value] of Object.entries(parsed)) config[name as keyof RenderOptions] = coerceOption(name, value) as never;
  }
  for (const [name, value] of Object.entries(args.tuning)) config[name as keyof RenderOptions] = value as never;

  const inputPath = args.input === "-" ? undefined : resolve(args.input);
  const source = inputPath ? await readFile(inputPath, "utf8") : await readStdin();
  const baseDirectory = inputPath ? dirname(inputPath) : process.cwd();
  const inter = loadInter(), fonts = [inter.body, inter.display];
  config = { bodyFont: inter.body.id, headingFont: inter.display.id, ...config };
  if (args.fontPath) {
    const custom = createFontFamily({ regular: new Uint8Array(await readFile(resolve(args.fontPath))) }, "custom");
    fonts.push(custom); config.bodyFont = custom.id; config.headingFont = custom.id;
  }
  const output = resolve(args.output ?? (inputPath ? `${inputPath.slice(0, -extname(inputPath).length)}.pdf` : "paintdown.pdf"));
  const renderer = createRenderer({ fonts, config, imageResolver: localImageResolver(baseDirectory) });
  const html = extname(output).toLowerCase() === ".html";
  const result = html ? await renderer.html(source) : await renderer.pdf(source);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, result);
  const size = typeof result === "string" ? Buffer.byteLength(result) : result.length;
  process.stdout.write(`${basename(output)} · ${size.toLocaleString()} bytes\n`);
}

main().catch(error => {
  process.stderr.write(`paintdown: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

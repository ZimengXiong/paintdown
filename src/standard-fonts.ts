import { loadNotoEmoji } from "./emoji.js";
import { loadSourceCodePro } from "./font-families/source-code-pro.js";
import { loadInter } from "./inter.js";

let cached: ReturnType<typeof createStandardFonts> | undefined;

function createStandardFonts() {
  const inter = loadInter();
  return {
    body: inter.body,
    display: inter.display,
    mono: loadSourceCodePro(),
    emoji: loadNotoEmoji(),
  };
}

export function loadStandardFonts() {
  return cached ??= createStandardFonts();
}

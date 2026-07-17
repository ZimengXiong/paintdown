import regular from "../fonts/noto-emoji/NotoEmoji-Regular.ttf";
import { createFontFamily } from "./fonts.js";

export function loadNotoEmoji() {
  const family = createFontFamily({ regular }, "noto-emoji");
  const face = family.styles.regular!;
  return { ...family, styles: { regular: face, bold: face, italic: face, bolditalic: face }, supplemental: true };
}

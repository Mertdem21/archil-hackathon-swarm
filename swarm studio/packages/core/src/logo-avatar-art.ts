import { botEyeColor } from "@swarm-studio/ui-tokens";
import type { AvatarEyes } from "./avatar-shape.js";
import { contrastRatio } from "./bot-avatar-colors.js";

export const LOGO_AVATAR_VIEWBOX = "0 0 100 100";

/** The body (and the eyes on it) sits this far down its plate. */
export const LOGO_AVATAR_BODY_Y = 9;

/** Oval eyes, in the body's own coordinates. */
export const LOGO_AVATAR_EYES: AvatarEyes = {
  width: 10.4,
  height: 16,
  leftCx: 40.5,
  rightCx: 59.5,
  cy: 40,
};

/** Dark eyes while they read on the body, otherwise whichever page color contrasts more. */
export function logoAvatarEyeInk(
  bodyColor: string,
  page: { background: string; foreground: string },
): string {
  if (contrastRatio(bodyColor, botEyeColor) >= 3.5) return botEyeColor;
  return contrastRatio(bodyColor, page.foreground) >= contrastRatio(bodyColor, page.background)
    ? page.foreground
    : page.background;
}

/** Rounded square shared by the animated and notification avatars. */
export const LOGO_BODY_PATH = "M28 10H72Q88 10 88 26V58Q88 74 72 74H28Q12 74 12 58V26Q12 10 28 10Z";

/** Shared vector paint palette for web SVG and react-native-svg. */
export function logoAvatarPaint(hex: string, originalOrange = false) {
  const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
  const raw = originalOrange ? "#ff7b08" : full;
  const rgb = [1, 3, 5].map((i) => Number.parseInt(raw.slice(i, i + 2), 16));
  const shade = (factor: number) =>
    `#${rgb
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v * factor)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  return {
    base: shade(1),
    light: shade(1.12),
    mid: shade(1),
    shadow: shade(0.8),
    edge: shade(0.96),
    deep: shade(0.55),
    flank: originalOrange ? "#c14d08" : shade(0.58),
    rim: originalOrange
      ? "#fff1dc"
      : `#${rgb
          .map((v) =>
            Math.round(v + (255 - v) * 0.9)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")}`,
  };
}

/** Shared, directional surface lighting for web and native SVG bodies. */
export const LOGO_AVATAR_LIGHTING = {
  body: { cx: "57%", cy: "30%", r: "76%" },
  flank: {
    gradientUnits: "userSpaceOnUse",
    cx: 0,
    cy: 0,
    r: 1,
    gradientTransform: "matrix(45 0 0 44 0 32)",
  },
  crown: {
    gradientUnits: "userSpaceOnUse",
    cx: 0,
    cy: 0,
    r: 1,
    gradientTransform: "matrix(34 0 0 33 57 23.5)",
    peak: 0.28,
    shoulder: 0.12,
  },
  rimUpper: {
    gradientUnits: "userSpaceOnUse",
    cx: 0,
    cy: 0,
    r: 1.1,
    gradientTransform: "matrix(35.3494 0 0 45.3948 50.0193 49.4219)",
  },
  rimLeftTrim: {
    gradientUnits: "userSpaceOnUse",
    cx: 0,
    cy: 0,
    r: 1,
    gradientTransform: "matrix(8.4 0 0 10.5 36 19)",
  },
  rimLeft: {
    gradientUnits: "userSpaceOnUse",
    cx: 0,
    cy: 0,
    r: 1.1,
    gradientTransform: "matrix(66.2501 0 0 63.0879 -50 30.676)",
  },
  rimRight: {
    gradientUnits: "userSpaceOnUse",
    cx: 0,
    cy: 0,
    r: 1.1,
    gradientTransform: "matrix(66.2472 0 0 63.3467 150 30.5562)",
  },
} as const;

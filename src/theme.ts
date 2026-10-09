// The modeller's look, as a components theme: upstream's near-black
// workshop greys, hairline white borders, and its one green accent
// (#6fcf97), which marks the selection and the primary action. One
// scheme only, as upstream ships dark alone.

import { defineTheme } from "@solidrt/components"

/** The upstream accent, for the few places that tint by hand. */
export const ACCENT = "#6fcf97"
export const ACCENT_TINT = "rgba(111,207,151,0.16)"
export const ACCENT_EDGE = "rgba(111,207,151,0.5)"
/** The canvas and window ground. */
export const GROUND = "#111114"
/** A panel laid over the canvas: the ground, a little see-through. */
export const PANEL = "rgba(17,17,20,0.9)"
/** Small headings and secondary readouts. */
export const QUIET = "#7d7d86"

export const modellerTheme = defineTheme({
  color: {
    background: GROUND,
    surface: "#17171c",
    surfaceAlt: "#23232a",
    text: "#e6e6ea",
    textMuted: "#a0a0a8",
    border: "rgba(255,255,255,0.18)",
    primary: ACCENT,
    onPrimary: "#0d1a12",
    secondary: "#26262d",
    onSecondary: "#e6e6ea",
    danger: "#ff9a8a",
    scrim: "rgba(0,0,0,0.45)",
    overlayHover: "rgba(255,255,255,0.08)",
    overlayPressed: "rgba(255,255,255,0.14)",
    selection: "rgba(111,207,151,0.35)",
    thumb: "#e6e6ea",
  },
  text: { base: 13, ratio: 1.2, roles: { caption: { size: 11 } } },
  radius: 8,
  components: {
    // Upstream's controls are outlined rather than filled.
    button: { borderColor: "rgba(255,255,255,0.18)", borderWidth: 1 },
    segmentedControl: { borderColor: "rgba(255,255,255,0.18)", borderWidth: 1 },
    textInput: { borderColor: "rgba(255,255,255,0.14)", borderWidth: 1 },
  },
})

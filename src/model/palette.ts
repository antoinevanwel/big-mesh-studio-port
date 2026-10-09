// The colours this model has used, so one can be reached again. Held by the
// application rather than a panel, so it outlives the panel being torn down
// on a resize; capped, dropping the oldest, so the newest is always pickable.

import { createSignal } from "@solidrt/core"
import { PALETTE_LIMIT } from "../file/project"
import { sameRgba } from "./colour"
import type { RGBA } from "./types"

export interface Palette {
  readonly colours: () => readonly RGBA[]
  readonly remember: (colour: RGBA) => boolean
  readonly set: (colours: readonly RGBA[]) => void
}

export const createPalette = (initial: readonly RGBA[] = []): Palette => {
  let held: readonly RGBA[] = initial.slice(0, PALETTE_LIMIT)
  let [colours, setColours] = createSignal<readonly RGBA[]>(held)
  return {
    colours,
    remember: colour => {
      if (held.some(existing => sameRgba(existing, colour))) return false
      held = [colour, ...held].slice(0, PALETTE_LIMIT)
      setColours(held)
      return true
    },
    set: incoming => {
      held = incoming.slice(0, PALETTE_LIMIT)
      setColours(held)
    },
  }
}

/** The palette a new document starts with. */
export const STARTER_PALETTE: readonly RGBA[] = [
  { r: 214, g: 96, b: 84, a: 255 },
  { r: 111, g: 207, b: 151, a: 255 },
  { r: 96, g: 150, b: 214, a: 255 },
]

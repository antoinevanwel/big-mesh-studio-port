// The brush: how wide, how soft, what colour, how paint meets a part's
// colour, and Clear paint. Ported from big-mesh-studios' sdf-modeller
// ui/brush-panel.tsx. Laid out.
//
// The width is in world units (the size on the model is what a person
// aims), chosen from a doubling ladder by index so the slider does not run
// backwards; softness is the stored hardness turned round, so the slider
// reads soft as it rises. The colour shows on the button that opens the
// picker, since it is the setting whose current value matters all the time.

import { createSignal, Show } from "@solidrt/core"
import { Button, Radio, RadioGroup, Slider, Text, View } from "@solidrt/components"
import { rgbaToCss } from "../model/colour"
import type { Palette } from "../model/palette"
import type { RGBA } from "../model/types"
import { Heading } from "./bits"
import { Checkers, ColourPicker } from "./colour-picker"
import { PaletteRow } from "./palette-row"

export interface BrushState {
  /** Across, in world units. */
  readonly width: number
  readonly hardness: number
  readonly colour: RGBA
}

/** The widths the size slider offers. */
export const WIDTHS: readonly number[] = [0.05, 0.1, 0.25, 0.5, 1, 2, 4]

/** A quarter of a unit across, a soft edge, in the colour given. */
export const defaultBrush = (colour: RGBA): BrushState => ({ width: 0.25, hardness: 0.5, colour })

export function BrushPanel(props: {
  brush: BrushState
  onWidth: (width: number) => void
  onHardness: (hardness: number) => void
  onColour: (colour: RGBA) => void
  palette: Palette
  /** What the paint field is, or undefined while nothing has been painted. */
  fieldDetail: string | undefined
  /** How many dabs the journal holds: whether it moves tells a brush that misses from a picture that does not update. */
  dabs: number
  hasPaint: boolean
  onClear: () => void
  blend: number
  onBlend: (blend: number) => void
  /** Whether the blend means anything yet (upstream: only over a baked atlas, which nothing makes now). */
  blendable: boolean
}) {
  let [picking, setPicking] = createSignal(false)
  let soft = () => Math.round((1 - props.brush.hardness) * 100)

  return (
    <View layout={{ gap: 8 }}>
      <Text variant="title">Brush</Text>
      <View layout={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <Text variant="caption" muted layout={{ width: 52 }}>size</Text>
        <Slider
          min={0}
          max={WIDTHS.length - 1}
          step={1}
          value={Math.max(0, WIDTHS.indexOf(props.brush.width))}
          onChange={index => {
            let chosen = WIDTHS[Math.round(index)]
            if (chosen !== undefined) props.onWidth(chosen)
          }}
          layout={{ flexGrow: 1 }}
        />
        <Text variant="caption" layout={{ width: 32 }}>{String(props.brush.width)}</Text>
      </View>
      <View layout={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <Text variant="caption" muted layout={{ width: 52 }}>soft</Text>
        <Slider min={0} max={100} step={5} value={soft()} onChange={value => props.onHardness(1 - value / 100)} layout={{ flexGrow: 1 }} />
        <Text variant="caption" layout={{ width: 32 }}>{String(soft())}</Text>
      </View>

      <Heading>Colour</Heading>
      <Button variant="secondary" onPress={() => setPicking(open => !open)}>
        <View layout={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <View layout={{ width: 18, height: 18 }}>
            <Checkers width={18} height={18} radius={4} />
            <d-rect color={rgbaToCss(props.brush.colour)} radius={4} />
          </View>
          <Text>{picking() ? "Done" : rgbaToCss(props.brush.colour)}</Text>
        </View>
      </Button>
      <Show when={picking()}>
        <ColourPicker colour={props.brush.colour} onColour={colour => props.onColour(colour)} />
      </Show>
      <PaletteRow palette={props.palette} colour={props.brush.colour} onPick={colour => props.onColour(colour)} />

      <Show when={props.fieldDetail}>
        {detail => <Text variant="caption" muted>{`${detail()} · ${props.dabs} dab${props.dabs === 1 ? "" : "s"}`}</Text>}
      </Show>

      <RadioGroup value={props.blend} onChange={value => props.onBlend(value as number)} disabled={!props.blendable} layout={{ flexDirection: "row", gap: 16 }}>
        <Radio value={0}>Tint</Radio>
        <Radio value={1}>Replace</Radio>
      </RadioGroup>
      <Button variant="secondary" disabled={!props.hasPaint} onPress={props.onClear}>
        Clear paint
      </Button>
    </View>
  )
}

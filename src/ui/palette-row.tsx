// The colours this model has used, as swatches to pick from, led by a "+"
// that keeps the current colour. Laid out.

import { For, Show } from "@solidrt/core"
import { Pressable, Text, View } from "@solidrt/components"
import { rgbaToCss, sameRgba } from "../model/colour"
import type { Palette } from "../model/palette"
import type { RGBA } from "../model/types"
import { ACCENT } from "../theme"
import { Checkers } from "./colour-picker"

const SWATCH = 28

function Swatch(props: { colour: RGBA; current?: boolean; label?: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} layout={{ width: SWATCH, height: SWATCH, alignItems: "center", justifyContent: "center" }}>
      {state => (
        <>
          <Checkers width={SWATCH} height={SWATCH} radius={5} />
          <d-rect color={rgbaToCss(props.colour)} radius={5} />
          <d-rect
            color={props.current ? ACCENT : state.hovered || state.pressed ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.18)"}
            drawStyle="stroke"
            strokeWidth={props.current ? 2 : 1}
            radius={5}
          />
          <Show when={props.label}>{label => <text color="#ffffff" fontSize={16} fontWeight={700}>{label()}</text>}</Show>
        </>
      )}
    </Pressable>
  )
}

export function PaletteRow(props: { palette: Palette; colour: RGBA | undefined; onPick: (colour: RGBA) => void }) {
  return (
    <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      <Show when={props.colour}>{colour => <Swatch colour={colour()} label="+" onPress={() => props.palette.remember(colour())} />}</Show>
      <For each={props.palette.colours()} fallback={<Text variant="caption" muted>colours you use are kept here</Text>}>
        {colour => <Swatch colour={colour} current={props.colour !== undefined && sameRgba(colour, props.colour)} onPress={() => props.onPick(colour)} />}
      </For>
    </View>
  )
}

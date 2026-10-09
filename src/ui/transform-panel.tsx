// The selected part: where it is, its dimensions, its colour, its boolean
// and softness, and (for the shapes a turn changes) its rotation. The panel
// reads outwards: the part, where it is, what it does to the model, what
// colour it is. Laid out.

import { createSignal, For, Show } from "@solidrt/core"
import { Button, SegmentedControl, Text, View } from "@solidrt/components"
import { rgbaToCss } from "../model/colour"
import type { ModelStore } from "../model/model-store"
import type { Palette } from "../model/palette"
import { fromEuler, MAX_SOFTNESS, toEuler, type Part } from "../model/part"
import { dimensionGroups, isAxial, withParameter, type DimensionField } from "../model/primitives"
import type { RGBA } from "../model/types"
import { QUIET } from "../theme"
import { Heading, NumberField } from "./bits"
import { Checkers, ColourPicker } from "./colour-picker"
import { PaletteRow } from "./palette-row"

const DEGREES = Math.PI / 180

export function TransformPanel(props: { part: Part; store: ModelStore; palette: Palette }) {
  let [picking, setPicking] = createSignal(false)
  let change = (fields: Parameters<ModelStore["change"]>[1], gesture?: unknown) => props.store.change(props.part.id, fields, gesture)
  let colour = (): RGBA | undefined => {
    let held = props.part.colour
    return held == null ? undefined : { r: held.r, g: held.g, b: held.b, a: Math.round((props.part.opacity ?? 1) * 255) }
  }
  let setColour = (next: RGBA, gesture?: unknown) => change({ colour: { r: next.r, g: next.g, b: next.b }, opacity: next.a / 255 }, gesture)
  let setDimension = (field: DimensionField, value: number) => change({ shape: withParameter(props.part.shape, field.name, field.axis, Math.max(field.min, value)) })
  let angles = () => toEuler(props.part.orientation)

  return (
    <View layout={{ gap: 8 }}>
      <View layout={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
        <Text variant="title">{props.part.shape.type}</Text>
        <Text variant="caption" style={{ color: QUIET }}>{props.part.id}</Text>
      </View>

      <Heading>Position</Heading>
      <For each={["x", "y", "z"] as const}>
        {axis => <NumberField label={axis} value={props.part.origin[axis]} onCommit={value => change({ origin: { ...props.part.origin, [axis]: value } })} />}
      </For>

      <Heading>Dimensions</Heading>
      <For each={dimensionGroups(props.part.shape)}>
        {group => (
          <Show when={group.fields.length > 1} fallback={<NumberField label={group.label} value={group.fields[0]!.value} onCommit={value => setDimension(group.fields[0]!, value)} />}>
            <Text variant="caption" muted>{group.label}</Text>
            <For each={group.fields}>{field => <NumberField label={field.label} value={field.value} onCommit={value => setDimension(field, value)} />}</For>
          </Show>
        )}
      </For>

      <Heading>Colour</Heading>
      <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View layout={{ width: 28, height: 28 }}>
          <Checkers width={28} height={28} radius={5} />
          <d-rect color={colour() === undefined ? "#bebab0" : rgbaToCss(colour()!)} radius={5} />
        </View>
        <Text muted layout={{ flexGrow: 1 }}>
          {props.part.colour == null ? "default" : `${props.part.colour.r}, ${props.part.colour.g}, ${props.part.colour.b}${(props.part.opacity ?? 1) < 1 ? ` · ${Math.round((props.part.opacity ?? 1) * 100)}%` : ""}`}
        </Text>
        <Show when={props.part.colour != null}>
          <Button variant="ghost" onPress={() => change({ colour: undefined, opacity: undefined })}>
            Clear
          </Button>
        </Show>
      </View>
      <Button variant="secondary" onPress={() => setPicking(open => !open)}>
        {picking() ? "Done" : "Choose colour…"}
      </Button>
      <Show when={picking()}>
        <ColourPicker colour={colour() ?? { r: 255, g: 255, b: 255, a: 255 }} onColour={setColour} />
      </Show>
      <PaletteRow palette={props.palette} colour={colour()} onPick={next => setColour(next)} />

      <Heading>Boolean</Heading>
      <SegmentedControl
        options={[
          { value: "Add" as const, label: "Union" },
          { value: "Subtract" as const, label: "Difference" },
        ]}
        value={props.part.combine}
        onChange={combine => change({ combine })}
      />
      <NumberField label="soft" value={props.part.softness} onCommit={value => change({ softness: Math.max(0, Math.min(MAX_SOFTNESS, value)) })} />
      <Text variant="caption" muted>
        {props.part.softness <= 0 ? "hard edge" : `soft ${props.part.combine === "Add" ? "union" : "difference"}`}
      </Text>

      <Show when={isAxial(props.part.shape.type)}>
        <Heading aside="degrees">Rotation</Heading>
        <For each={["yaw", "pitch", "roll"] as const}>
          {axis => (
            <NumberField
              label={axis}
              digits={1}
              value={angles()[axis]}
              onCommit={value => {
                // Composed from the angles on screen, so setting one field
                // gives the turn that was asked for whatever was typed first.
                let shown = { ...angles(), [axis]: value }
                change({ orientation: fromEuler(shown.yaw * DEGREES, shown.pitch * DEGREES, shown.roll * DEGREES) })
              }}
            />
          )}
        </For>
      </Show>
    </View>
  )
}

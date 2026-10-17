// The primitive picker and the parts list: duplicate the selected part,
// reorder (the parts fold in list order, so the order is the model), remove.
// Laid out.

import { For, Show } from "@solidrt/core"
import { Button, Item, Text, View } from "@solidrt/components"
import { MAX_PARTS, type ModelStore } from "../model/model-store"
import { placedPart } from "../model/part"
import { defaultShape, PALETTE_NAMES } from "../model/primitives"
import { ACCENT_EDGE, ACCENT_TINT, QUIET } from "../theme"
import { Heading } from "./bits"

const round = (value: number): string => value.toFixed(1)

/** The small square buttons on a row. */
const ROW_BUTTON = { paddingLeft: 7, paddingRight: 7 }

export function PartsPanel(props: {
  store: ModelStore
  /** A copy landed, under this id; the shell hands it to the move tool, since it sits on top of the original. */
  onDuplicate?: (id: string) => void
}) {
  let full = () => props.store.parts().length >= MAX_PARTS
  return (
    <View layout={{ gap: 8 }}>
      <Heading>Add</Heading>
      <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
        <For each={PALETTE_NAMES}>
          {type => (
            <Button
              variant="secondary"
              disabled={full()}
              layout={{ flexGrow: 1, minWidth: 72, paddingLeft: 8, paddingRight: 8 }}
              onPress={() => props.store.add(placedPart(props.store.nextId(), defaultShape(type), { x: 0, y: 0, z: 0 }))}
            >
              {type}
            </Button>
          )}
        </For>
      </View>

      <Heading aside={String(props.store.parts().length)}>Parts</Heading>
      {/* One button for the selection rather than one per row: a copy is almost always of the part being worked on. */}
      <Button
        variant="secondary"
        disabled={full() || props.store.selected() === undefined}
        onPress={() => {
          let source = props.store.selected()
          let copied = source === undefined ? undefined : props.store.duplicate(source)
          if (copied !== undefined) props.onDuplicate?.(copied)
        }}
      >
        Duplicate
      </Button>
      <Show when={props.store.parts().length > 0} fallback={<Text muted>No parts yet. Add one above.</Text>}>
        <View layout={{ gap: 2 }}>
          <For each={props.store.parts()}>
            {(part, index) => {
              let selected = () => props.store.selected() === part.id
              return (
                <Item
                  label={`${part.combine === "Subtract" ? "− " : ""}${part.shape.type}`}
                  startContent={
                    <View
                      layout={{ width: 10, height: 10 }}
                      style={{
                        borderRadius: 5,
                        backgroundColor: part.colour == null ? "transparent" : `rgb(${part.colour.r},${part.colour.g},${part.colour.b})`,
                        borderColor: "rgba(255,255,255,0.3)",
                        borderWidth: 1,
                      }}
                    />
                  }
                  endContent={
                    <View layout={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                      <Text variant="caption" style={{ color: QUIET }} layout={{ marginRight: 2 }}>{`${round(part.origin.x)}, ${round(part.origin.y)}, ${round(part.origin.z)}`}</Text>
                      {/* Dimmed at the ends rather than hidden, so the row does not shift as a part reaches the top or bottom. */}
                      <Button variant="ghost" disabled={index() === 0} layout={ROW_BUTTON} style={{ borderWidth: 0 }} onPress={() => props.store.moveUp(part.id)}>
                        ▲
                      </Button>
                      <Button variant="ghost" disabled={index() === props.store.parts().length - 1} layout={ROW_BUTTON} style={{ borderWidth: 0 }} onPress={() => props.store.moveDown(part.id)}>
                        ▼
                      </Button>
                      <Button variant="ghost" layout={ROW_BUTTON} style={{ borderWidth: 0 }} onPress={() => props.store.remove(part.id)}>
                        ×
                      </Button>
                    </View>
                  }
                  onPress={() => props.store.select(part.id)}
                  style={selected() ? { backgroundColor: ACCENT_TINT, borderColor: ACCENT_EDGE, borderWidth: 1 } : { borderColor: "transparent", borderWidth: 1 }}
                />
              )
            }}
          </For>
        </View>
      </Show>
    </View>
  )
}

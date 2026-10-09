// The primitive picker and the parts list. Laid out.

import { For, Show } from "@solidrt/core"
import { Button, Item, Text, View } from "@solidrt/components"
import { MAX_PARTS, type ModelStore } from "../model/model-store"
import { placedPart } from "../model/part"
import { defaultShape, PRIMITIVE_NAMES } from "../model/primitives"
import { ACCENT_EDGE, ACCENT_TINT, QUIET } from "../theme"
import { Heading } from "./bits"

const round = (value: number): string => value.toFixed(1)

export function PartsPanel(props: { store: ModelStore }) {
  let full = () => props.store.parts().length >= MAX_PARTS
  return (
    <View layout={{ gap: 8 }}>
      <Heading>Add</Heading>
      <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
        <For each={PRIMITIVE_NAMES}>
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
      <Show when={props.store.parts().length > 0} fallback={<Text muted>No parts yet. Add one above.</Text>}>
        <View layout={{ gap: 2 }}>
          <For each={props.store.parts()}>
            {part => {
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
                    <View layout={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Text variant="caption" style={{ color: QUIET }}>{`${round(part.origin.x)}, ${round(part.origin.y)}, ${round(part.origin.z)}`}</Text>
                      <Button variant="ghost" layout={{ paddingLeft: 8, paddingRight: 8 }} style={{ borderWidth: 0 }} onPress={() => props.store.remove(part.id)}>
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

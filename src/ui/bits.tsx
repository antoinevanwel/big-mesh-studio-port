// Small pieces the panels share: the uppercase section heading and the
// labelled number field. Laid out.

import { createSignal, Show } from "@solidrt/core"
import { Text, TextInput, View } from "@solidrt/components"
import { QUIET } from "../theme"

/** A small uppercase heading, with an optional readout pushed to its right. */
export function Heading(props: { children: string; aside?: string }) {
  return (
    <View layout={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 4 }}>
      <Text variant="caption" layout={{ fontWeight: 600 }} style={{ color: QUIET }}>
        {props.children.toUpperCase()}
      </Text>
      <Show when={props.aside}>{aside => <Text variant="caption" muted>{aside()}</Text>}</Show>
    </View>
  )
}

/**
 * A number somebody types. The text is held as typed until it is committed
 * (Enter, or leaving the field), so typing "1" on the way to "150" is not
 * an edit of 1; a field that does not parse is put back.
 */
export function NumberField(props: { label: string; value: number; digits?: number; onCommit: (value: number) => void; labelWidth?: number }) {
  let [draft, setDraft] = createSignal<string | undefined>()
  let shown = () => draft() ?? props.value.toFixed(props.digits ?? 2)
  let commit = () => {
    let text = draft()
    if (text === undefined) return
    setDraft(undefined)
    let value = Number(text.replace(",", "."))
    if (text.trim() !== "" && Number.isFinite(value)) props.onCommit(value)
  }
  return (
    <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text variant="caption" muted layout={{ width: props.labelWidth ?? 52, flexShrink: 0 }}>
        {props.label}
      </Text>
      <TextInput
        value={shown()}
        onInput={setDraft}
        onSubmit={commit}
        onBlur={commit}
        hints={{ type: "number", capitalize: "none", autocorrect: false }}
        layout={{ flexGrow: 1, minWidth: 0 }}
      />
    </View>
  )
}

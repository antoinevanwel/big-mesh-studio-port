// Small pieces the panels share: the uppercase section heading and the
// labelled number field with its steppers. Laid out.

import { createSignal, Show } from "@solidrt/core"
import { Button, Text, TextInput, View } from "@solidrt/components"
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

/** The stepper buttons beside a number field. */
const STEP_BUTTON = { paddingLeft: 9, paddingRight: 9 }

/**
 * A number somebody types, or steps with − and +. The text is held as typed
 * until it is committed (Enter, or leaving the field), so typing "1" on the
 * way to "150" is not an edit of 1; a field that does not parse is put back.
 * With a `step`, a step commits at once, since a press is already a whole act, and goes
 * through the same `onCommit`, so the caller's clamps apply to it too.
 */
export function NumberField(props: {
  label: string
  value: number
  /** What − and + add and take away. */
  step?: number
  /** In place of `step`: where − (-1) and + (1) go from a value, for steps that are not linear. */
  stepTo?: (value: number, direction: 1 | -1) => number
  digits?: number
  /** In place of `digits`: how the value is shown. */
  format?: (value: number) => string
  onCommit: (value: number) => void
  labelWidth?: number
}) {
  let [draft, setDraft] = createSignal<string | undefined>()
  let shown = () => draft() ?? (props.format?.(props.value) ?? props.value.toFixed(props.digits ?? 2))
  let commit = () => {
    let text = draft()
    if (text === undefined) return
    setDraft(undefined)
    let value = Number(text.replace(",", "."))
    if (text.trim() !== "" && Number.isFinite(value)) props.onCommit(value)
  }
  // Rounded so a run of 0.05 steps stays 0.15 rather than 0.15000000000000002.
  let step = (direction: 1 | -1) => {
    setDraft(undefined)
    props.onCommit(props.stepTo !== undefined ? props.stepTo(props.value, direction) : Math.round((props.value + direction * props.step!) * 1e6) / 1e6)
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
        // Text rather than "number": a phone's numeric keypad may have no
        // minus key (upstream hit that), and the steppers cover the common case.
        hints={{ capitalize: "none", autocorrect: false }}
        layout={{ flexGrow: 1, minWidth: 0 }}
      />
      <Show when={props.step !== undefined || props.stepTo !== undefined}>
        <Button variant="secondary" layout={STEP_BUTTON} onPress={() => step(-1)}>
          −
        </Button>
        <Button variant="secondary" layout={STEP_BUTTON} onPress={() => step(1)}>
          +
        </Button>
      </Show>
    </View>
  )
}

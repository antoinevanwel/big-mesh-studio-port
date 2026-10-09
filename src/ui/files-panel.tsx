// "Your files": the document's name and Save, New, the export for a 3D
// printer, and the models kept in this app's storage as cards to open.
// Upstream opens and saves through the browser's file pickers; there are
// none here, so the cards are the open dialog (see FEEDBACK.md). Laid out.

import { createSignal, For, Show } from "@solidrt/core"
import { Button, Card, Divider, Pressable, ScrollView, Text, TextInput, View } from "@solidrt/components"
import type { SavedModel } from "../file/library"
import { ACCENT, QUIET } from "../theme"
import { Heading, NumberField } from "./bits"

/** A time as people say it: "a moment ago", "3 min ago", "yesterday". */
export const ago = (at: number, now: number = Date.now()): string => {
  let seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 45) return "a moment ago"
  let minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  let hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  let days = Math.round(hours / 24)
  if (days < 2) return "yesterday"
  if (days < 7) return `${days} days ago`
  return new Date(at).toLocaleDateString()
}

export interface FilesPanelProps {
  readonly name: string | undefined
  readonly parts: number
  readonly models: readonly SavedModel[]
  readonly draftAt: number | undefined
  /** What the viewport's mesh says about printing it. */
  readonly readout: string
  readonly height: number
  readonly filaments: number
  readonly notice: string | undefined
  readonly exported: string | undefined
  readonly busy: boolean
  readonly onNew: () => void
  readonly onSave: (name: string) => void
  readonly onOpen: (name: string) => void
  readonly onDelete: (name: string) => void
  readonly onExport: () => void
  readonly onHeight: (mm: number) => void
  readonly onFilaments: (count: number) => void
  readonly onClose: () => void
}

export function FilesPanel(props: FilesPanelProps) {
  let [typed, setTyped] = createSignal<string | undefined>()
  let [doomed, setDoomed] = createSignal<string | undefined>()
  let saveName = () => typed() ?? props.name ?? "model"

  return (
    <View layout={{ gap: 12, flexGrow: 1, minHeight: 0 }}>
      <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View layout={{ flexGrow: 1, minWidth: 0 }}>
          <Text variant="title">{props.name ?? "Untitled model"}</Text>
          <Text variant="caption" muted>
            {props.name === undefined ? "not saved anywhere yet" : `${props.parts} part${props.parts === 1 ? "" : "s"}`}
          </Text>
        </View>
        <Button variant="ghost" onPress={props.onClose}>
          Close
        </Button>
      </View>

      <View layout={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <TextInput
          value={saveName()}
          onInput={setTyped}
          onSubmit={() => props.onSave(saveName())}
          placeholder="name"
          hints={{ capitalize: "none", autocorrect: false }}
          layout={{ flexGrow: 1, minWidth: 140 }}
        />
        <Button disabled={props.busy} onPress={() => props.onSave(saveName())}>
          Save
        </Button>
        <Button variant="secondary" disabled={props.busy} onPress={props.onNew}>
          New
        </Button>
      </View>

      <Show when={props.notice}>{notice => <Text color="danger">{notice()}</Text>}</Show>
      <Show when={props.draftAt}>{at => <Text variant="caption" muted>{`draft kept in this app ${ago(at())}`}</Text>}</Show>

      <Card title="Print">
        <View layout={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
          <View layout={{ flexGrow: 1, minWidth: 150 }}>
            <NumberField label="height mm" labelWidth={72} digits={0} value={props.height} onCommit={value => props.onHeight(value)} />
          </View>
          <View layout={{ flexGrow: 1, minWidth: 150 }}>
            <NumberField label="filaments" labelWidth={72} digits={0} value={props.filaments} onCommit={value => props.onFilaments(value)} />
          </View>
        </View>
        <Text variant="caption" muted>{`on screen: ${props.readout}`}</Text>
        <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button variant="secondary" disabled={props.busy} onPress={props.onExport}>
            Export .3mf
          </Button>
          <Show when={props.exported}>{path => <Text variant="caption" muted layout={{ flexShrink: 1 }}>{`written to ${path()}`}</Text>}</Show>
        </View>
      </Card>

      <Divider />
      <Heading aside={String(props.models.length)}>Your models</Heading>
      <ScrollView layout={{ flexGrow: 1, minHeight: 120 }}>
        <Show when={props.models.length > 0} fallback={<Text muted>No saved models yet. Save one and it will be here.</Text>}>
          <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 8 }}>
            <For each={props.models}>
              {model => (
                <View layout={{ width: 150, gap: 4 }}>
                  <Pressable disabled={props.busy} onPress={() => props.onOpen(model.name)} layout={{ height: 96, alignItems: "center", justifyContent: "center" }}>
                    {state => (
                      <>
                        <d-rect color={state.pressed ? "#2a2a32" : state.hovered ? "#22222a" : "#1b1b21"} radius={8} />
                        <d-rect color={model.name === props.name ? ACCENT : "rgba(255,255,255,0.12)"} drawStyle="stroke" strokeWidth={1} radius={8} />
                        <Text variant="heading">{String(model.parts)}</Text>
                        <Text variant="caption" style={{ color: QUIET }}>{model.parts === 1 ? "part" : "parts"}</Text>
                      </>
                    )}
                  </Pressable>
                  <Text layout={{ maxWidth: 150 }}>{model.name}</Text>
                  <View layout={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text variant="caption" muted>{model.savedAt === undefined ? "" : ago(model.savedAt)}</Text>
                    <Button
                      variant={doomed() === model.name ? "danger" : "ghost"}
                      disabled={props.busy}
                      layout={{ paddingLeft: 8, paddingRight: 8 }}
                      onPress={() => {
                        if (doomed() !== model.name) return setDoomed(model.name)
                        setDoomed(undefined)
                        props.onDelete(model.name)
                      }}
                    >
                      {doomed() === model.name ? "Delete?" : "Delete"}
                    </Button>
                  </View>
                </View>
              )}
            </For>
          </View>
        </Show>
      </ScrollView>
    </View>
  )
}

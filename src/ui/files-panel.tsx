// "Your files": the document, New, Open and Save through the platform's file
// dialogs, the export for a 3D printer, and the files opened before as cards
// to open again. Laid out.

import { For, Show } from "@solidrt/core"
import { Button, Card, Divider, ProgressBar, Pressable, ScrollView, Text, View } from "@solidrt/components"
import { homeName, type Home } from "../file/home"
import type { RecentFile } from "../file/recent-files"
import { PRINT_RESOLUTIONS } from "../print/print"
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
  readonly home: Home
  readonly parts: number
  readonly recent: readonly RecentFile[]
  /** The platform shows file dialogs; without them Save writes into the app's storage. */
  readonly showsDialogs: boolean
  readonly draftAt: number | undefined
  /** What the viewport's mesh says about printing it. */
  readonly readout: string
  readonly height: number
  readonly filaments: number
  /** The print's voxel size, as typed (checked at Export). */
  readonly resolution: number
  /** What a print at that resolution will cost, or "" for none to give. */
  readonly estimate: string
  /** How far an export's meshing has got (0..1), while one runs. */
  readonly printing: number | undefined
  /** The name and size of a built print waiting to be saved, or undefined. */
  readonly builtFile: string | undefined
  readonly notice: string | undefined
  /** Where the last file went when there was no dialog to ask, or undefined. */
  readonly written: string | undefined
  readonly busy: boolean
  readonly onNew: () => void
  readonly onOpen: () => void
  readonly onSave: () => void
  readonly onOpenRecent: (file: RecentFile) => void
  readonly onForgetRecent: (path: string) => void
  /** Meshes and encodes the print, holding it for onSavePrint. */
  readonly onExport: () => void
  readonly onSavePrint: () => void
  readonly onHeight: (mm: number) => void
  readonly onFilaments: (count: number) => void
  readonly onResolution: (voxelSize: number) => void
  readonly onClose: () => void
}

export function FilesPanel(props: FilesPanelProps) {
  return (
    <View layout={{ gap: 12, flexGrow: 1, minHeight: 0 }}>
      <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View layout={{ flexGrow: 1, minWidth: 0 }}>
          <Text variant="title">{homeName(props.home)}</Text>
          <Text variant="caption" muted>
            {props.home.kind === "nowhere" ? "not saved anywhere yet" : `${props.parts} part${props.parts === 1 ? "" : "s"}`}
          </Text>
        </View>
        <Button variant="ghost" onPress={props.onClose}>
          Close
        </Button>
      </View>

      <View layout={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="secondary" disabled={props.busy} onPress={props.onNew}>
          New
        </Button>
        <Button variant="secondary" disabled={props.busy} onPress={props.onOpen}>
          Open
        </Button>
        <Button disabled={props.busy} onPress={props.onSave}>
          Save
        </Button>
      </View>

      <Show when={props.notice}>{notice => <Text color="danger">{notice()}</Text>}</Show>
      <Show when={props.draftAt}>{at => <Text variant="caption" muted>{`draft kept in this app ${ago(at())}`}</Text>}</Show>
      <Show when={props.written}>{path => <Text variant="caption" muted>{`written to ${path()}`}</Text>}</Show>

      <Card title="Print">
        <View layout={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
          <View layout={{ flexGrow: 1, minWidth: 150 }}>
            <NumberField label="height mm" labelWidth={72} digits={0} step={1} value={props.height} onCommit={value => props.onHeight(value)} />
          </View>
          <View layout={{ flexGrow: 1, minWidth: 150 }}>
            <NumberField label="filaments" labelWidth={72} digits={0} step={1} value={props.filaments} onCommit={value => props.onFilaments(value)} />
          </View>
        </View>
        {/* A typed size, as upstream's: the cost underneath is what makes it safe to type one. */}
        <NumberField
          label="resolution"
          labelWidth={72}
          format={String}
          stepTo={(value, direction) =>
            direction > 0 ? (PRINT_RESOLUTIONS.find(size => size > value) ?? value) : ([...PRINT_RESOLUTIONS].reverse().find(size => size < value) ?? value)
          }
          value={props.resolution}
          onCommit={value => props.onResolution(value)}
        />
        <Show when={props.estimate !== ""}>
          <Text variant="caption" muted>
            {props.estimate}
          </Text>
        </Show>
        <Text variant="caption" muted>{`on screen: ${props.readout}`}</Text>
        <Show when={props.printing !== undefined}>
          <ProgressBar value={props.printing} />
        </Show>
        {/* One button, two steps, as upstream's: the first meshes and holds
            the file, the second (naming it and its size) asks where it goes. */}
        <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button variant="secondary" disabled={props.busy} onPress={() => (props.builtFile === undefined ? props.onExport() : props.onSavePrint())}>
            {props.builtFile === undefined ? "Export .3mf" : `Save ${props.builtFile}`}
          </Button>
        </View>
      </Card>

      <Divider />
      <Heading aside={String(props.recent.length)}>Opened before</Heading>
      <ScrollView layout={{ flexGrow: 1, minHeight: 120 }}>
        <Show
          when={props.recent.length > 0}
          fallback={
            <Text muted>
              {props.showsDialogs
                ? "No files opened yet. Open one and it will be here."
                : "This device shows no file dialog, so Save keeps models in this app, and they are listed here."}
            </Text>
          }
        >
          <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 8 }}>
            <For each={props.recent}>
              {entry => (
                <View layout={{ width: 150, gap: 4 }}>
                  <Pressable disabled={props.busy} onPress={() => props.onOpenRecent(entry)} layout={{ height: 96, alignItems: "center", justifyContent: "center" }}>
                    {state => (
                      <>
                        <d-rect color={state.pressed ? "#2a2a32" : state.hovered ? "#22222a" : "#1b1b21"} radius={8} />
                        <d-rect
                          color={props.home.kind === "file" && props.home.path === entry.path ? ACCENT : "rgba(255,255,255,0.12)"}
                          drawStyle="stroke"
                          strokeWidth={1}
                          radius={8}
                        />
                        <Text variant="heading">{String(entry.parts)}</Text>
                        <Text variant="caption" style={{ color: QUIET }}>{entry.parts === 1 ? "part" : "parts"}</Text>
                      </>
                    )}
                  </Pressable>
                  <Text layout={{ maxWidth: 150 }}>{entry.name}</Text>
                  <View layout={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text variant="caption" muted>{ago(entry.lastOpenedAt)}</Text>
                    {/* Forgetting drops it from this list; the file itself is untouched. */}
                    <Button variant="ghost" disabled={props.busy} layout={{ paddingLeft: 8, paddingRight: 8 }} onPress={() => props.onForgetRecent(entry.path)}>
                      Forget
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

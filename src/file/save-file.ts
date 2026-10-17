// Getting bytes in and out through the platform's own file dialogs
// (flux:dialog). A cancel is a value here, never an error: undefined from
// both choosers. Where the platform shows no dialog (iOS, a Linux session
// without the portal or zenity), the call rejects with NotSupportedError;
// the choosers answer UNSUPPORTED and the caller writes into the app's own
// storage instead (library.ts), as upstream downloads where the browser has
// no save picker. The call is the test, not Flux.capabilities: under
// `sol test` the list lacks "dialog" while the test answers every dialog
// (SOLIDRT-FEEDBACK.md).

import { createSignal } from "@solidrt/core"
import { openFiles, saveFile } from "flux:dialog"

/** What a save dialog is told the file is. */
export interface FileChoice {
  readonly description: string
  /** Without the dot. */
  readonly extension: string
}

/** A file that was picked: where it is, and what the picker called it. */
export interface PickedFile {
  readonly path: string
  readonly name: string
}

export const UNSUPPORTED = "unsupported"

// Learnt from the first refusal, for what the Files dialog says about itself.
let [missing, setMissing] = createSignal(false)
export const dialogsMissing = missing

const unlessUnsupported = async <T,>(call: () => Promise<T>): Promise<T | typeof UNSUPPORTED> => {
  try {
    return await call()
  } catch (reason) {
    if ((reason as { name?: unknown } | null)?.name !== "NotSupportedError") throw reason
    setMissing(true)
    return UNSUPPORTED
  }
}

/**
 * A file to read, or undefined when the person backed out. No type filter,
 * as upstream: `.sdfmod` has no media type, so a filtered picker on a phone
 * greys the model out; readProject is the validation and says a sentence.
 */
export const chooseFileToRead = async (): Promise<PickedFile | undefined | typeof UNSUPPORTED> => {
  let picked = await unlessUnsupported(() => openFiles({ multiple: false }))
  if (picked === UNSUPPORTED) return UNSUPPORTED
  return picked[0] === undefined ? undefined : { path: picked[0].path, name: picked[0].name }
}

/** A place to write, or undefined when the person backed out. */
export const choosePlaceToWrite = async (choice: FileChoice, suggestedName: string): Promise<PickedFile | undefined | typeof UNSUPPORTED> => {
  let target = await unlessUnsupported(() => saveFile({ suggestedName, types: [{ description: choice.description, extensions: [choice.extension] }] }))
  if (target === UNSUPPORTED) return UNSUPPORTED
  return target === null ? undefined : { path: target.path, name: target.name }
}

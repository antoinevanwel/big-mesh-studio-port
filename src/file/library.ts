// What lives in the app's own storage folder: the autosaved draft (upstream
// keeps it in IndexedDB), and, where the platform shows no file dialog,
// the files Save and Export write in place of upstream's download: models/
// and exports/, under a name made free the way a download folder does.

import { dir, file, realpath } from "flux:fs"
import { MODELS } from "./recent-files"

const EXPORTS = "exports"
const DRAFT = "draft.sdfmod"
const DRAFT_AT = "draft.json"

export interface Draft {
  readonly bytes: Uint8Array
  readonly at: number
}

export const readDraft = async (): Promise<Draft | undefined> => {
  let handle = file(DRAFT)
  if (!(await handle.exists())) return undefined
  let at = 0
  try {
    at = (await file(DRAFT_AT).json()).at ?? 0
  } catch {}
  return { bytes: await handle.bytes(), at }
}

export const saveDraft = async (bytes: Uint8Array, at: number): Promise<void> => {
  await file(DRAFT).write(bytes, { atomic: true })
  await file(DRAFT_AT).write(JSON.stringify({ at }))
}

export const clearDraft = async (): Promise<void> => {
  await file(DRAFT).remove()
  await file(DRAFT_AT).remove()
}

// "model.sdfmod", else "model (1).sdfmod", ...: never over an earlier file.
const freePath = async (folder: string, name: string): Promise<string> => {
  let dot = name.lastIndexOf(".")
  let [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""]
  for (let n = 0; ; n++) {
    let path = `${folder}/${n === 0 ? stem : `${stem} (${n})`}${extension}`
    if (!(await file(path).exists())) return path
  }
}

/** Writes into folder/ under a free name; returns where, as `file()` and the OS spell it. */
const writeInStorage = async (folder: string, name: string, bytes: Uint8Array): Promise<{ path: string; name: string; shown: string }> => {
  await dir(folder).create()
  let path = await freePath(folder, name)
  await file(path).write(bytes, { atomic: true })
  return { path, name: path.slice(folder.length + 1), shown: await realpath(path) }
}

export const writeModelInStorage = (name: string, bytes: Uint8Array) => writeInStorage(MODELS, name, bytes)

export const writeExportInStorage = (name: string, bytes: Uint8Array) => writeInStorage(EXPORTS, name, bytes)

// Where documents live: the app's own storage folder. There is no system
// open or save dialog here (FEEDBACK.md), so projects are kept in models/
// under storage and listed in the Files dialog, the autosaved draft is one
// file beside them, and prints are written to exports/.

import { dir, file, realpath } from "flux:fs"
import { PROJECT_EXTENSION } from "./project"
import { ZipReader } from "./zip"

const MODELS = "models"
const EXPORTS = "exports"
const DRAFT = "draft.sdfmod"
const DRAFT_AT = "draft.json"

export interface SavedModel {
  /** The document name: the file name without its extension. */
  readonly name: string
  readonly parts: number
  /** When it was last written, ms since the epoch, or undefined when unknown. */
  readonly savedAt: number | undefined
}

/** A name safe to use as a file name; empty when nothing usable was typed. */
export const cleanName = (typed: string): string =>
  typed
    .replace(/\.sdfmod$/i, "")
    .replace(/[^\p{L}\p{N} _.-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64)

const pathOf = (name: string): string => `${MODELS}/${name}${PROJECT_EXTENSION}`

const partsIn = (bytes: Uint8Array): number => {
  try {
    let manifest = JSON.parse(new ZipReader(bytes).textOf("manifest.json") ?? "{}")
    return Array.isArray(manifest.ids) ? manifest.ids.length : 0
  } catch {
    return 0
  }
}

/** Every saved model, most recently written first. */
export const listModels = async (): Promise<SavedModel[]> => {
  let folder = dir(MODELS)
  if (!(await folder.exists())) return []
  let found: SavedModel[] = []
  for (let entry of await folder.entries()) {
    if (entry.type !== "file" || !entry.name.endsWith(PROJECT_EXTENSION)) continue
    let handle = file(`${MODELS}/${entry.name}`)
    let [bytes, stat] = await Promise.all([handle.bytes(), handle.stat()])
    found.push({ name: entry.name.slice(0, -PROJECT_EXTENSION.length), parts: partsIn(bytes), savedAt: stat.mtime })
  }
  return found.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0) || a.name.localeCompare(b.name))
}

export const readModel = (name: string): Promise<Uint8Array> => file(pathOf(name)).bytes()

export const modelExists = (name: string): Promise<boolean> => file(pathOf(name)).exists()

export const saveModel = async (name: string, bytes: Uint8Array): Promise<void> => {
  await dir(MODELS).create()
  // Written beside and renamed over, so a failed write never leaves half a model.
  let temporary = file(`${pathOf(name)}.part`)
  await temporary.write(bytes)
  await temporary.rename(pathOf(name))
}

export const deleteModel = (name: string): Promise<void> => file(pathOf(name)).remove()

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
  await file(DRAFT).write(bytes)
  await file(DRAFT_AT).write(JSON.stringify({ at }))
}

export const clearDraft = async (): Promise<void> => {
  await file(DRAFT).remove()
  await file(DRAFT_AT).remove()
}

/** Writes a print and returns where it landed, as the OS spells the path. */
export const writeExport = async (name: string, bytes: Uint8Array): Promise<string> => {
  await dir(EXPORTS).create()
  let path = `${EXPORTS}/${name}.3mf`
  await file(path).write(bytes)
  return realpath(path)
}

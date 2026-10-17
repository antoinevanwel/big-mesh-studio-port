// The files this editor has opened or written, so they can be opened again
// without hunting for them. Upstream keeps file handles in IndexedDB; a path
// here does the same job and survives a restart on its own (a content:// URI
// on Android is persisted by the dialog), so there is no permission to ask
// and no way to lose the list's ability to read. Kept in recent.json in the
// app's storage, a name and a part count beside each path so the list draws
// without reading a single file.

import { dir, file } from "flux:fs"
import { PROJECT_EXTENSION } from "./project"
import { ZipReader } from "./zip"

const RECENT = "recent.json"
/** Where the port kept its models before it had file dialogs (and still does without one). */
export const MODELS = "models"

/** How many files are remembered before the least recently opened is dropped. */
export const REMEMBERED = 12

export interface RecentFile {
  /** What opens it: `file(path)`. Also the entry's key. */
  readonly path: string
  /** The file's name as it was when last seen. */
  readonly name: string
  readonly parts: number
  readonly lastOpenedAt: number
}

/** How many parts a project file holds, without reading it as a model. */
export const partsIn = async (bytes: Uint8Array): Promise<number> => {
  try {
    let manifest = JSON.parse((await new ZipReader(bytes).textOf("manifest.json")) ?? "{}")
    return Array.isArray(manifest.ids) ? manifest.ids.length : 0
  } catch {
    return 0
  }
}

// The models saved by the port before it had dialogs, so they stay reachable.
const fromModelsFolder = async (): Promise<RecentFile[]> => {
  let folder = dir(MODELS)
  if (!(await folder.exists())) return []
  let found: RecentFile[] = []
  for (let entry of await folder.entries()) {
    if (entry.type !== "file" || !entry.name.endsWith(PROJECT_EXTENSION)) continue
    let handle = file(entry.path)
    let [bytes, stat] = await Promise.all([handle.bytes(), handle.stat()])
    found.push({ path: entry.path, name: entry.name, parts: await partsIn(bytes), lastOpenedAt: stat.mtime ?? 0 })
  }
  return found
}

const store = (files: readonly RecentFile[]): Promise<void> => file(RECENT).write(JSON.stringify(files), { atomic: true })

/** Every remembered file, most recently opened first. */
export const listRecentFiles = async (): Promise<RecentFile[]> => {
  let handle = file(RECENT)
  let stored: unknown
  if (await handle.exists()) {
    try {
      stored = await handle.json()
    } catch {
      stored = []
    }
  } else {
    // First run with dialogs: what models/ held becomes the list.
    stored = await fromModelsFolder()
    await store(stored as RecentFile[])
  }
  if (!Array.isArray(stored)) return []
  return stored
    .filter((entry): entry is RecentFile => typeof entry?.path === "string" && typeof entry?.name === "string")
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, REMEMBERED)
}

/** Records that a file was just opened or written; one entry per path. */
export const rememberFile = async (path: string, name: string, parts: number): Promise<void> => {
  let known = await listRecentFiles()
  let remembered: RecentFile = { path, name, parts, lastOpenedAt: Date.now() }
  await store([remembered, ...known.filter(entry => entry.path !== path)].slice(0, REMEMBERED))
}

/** Drops one file from the list. The file itself is untouched. */
export const forgetFile = async (path: string): Promise<void> => {
  await store((await listRecentFiles()).filter(entry => entry.path !== path))
}

/** The file's bytes, or undefined for every reason it could not be read. */
export const readThrough = async (path: string): Promise<Uint8Array | undefined> => {
  try {
    return await file(path).bytes()
  } catch {
    return undefined
  }
}

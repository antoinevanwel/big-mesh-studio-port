// The document: the parts, the selection, and an undo history. Every edit
// is one history entry with an explicit inverse; a removed part comes back
// at the index it had; opening a file is one entry, not one per part.
// Ported from big-mesh-studios' sdf-modeller model-store.ts.
//
// The truth lives in plain variables and the signals publish it. Signal
// writes land on the next microtask, so a handler that edits twice in one
// go (or undoes then redoes) must not read the list back from a signal.

import { createSignal, type Accessor } from "@solidrt/core"
import { MAX_PARTS } from "../file/project"
import type { Part } from "./part"

export { MAX_PARTS }

export const HISTORY_LIMIT = 100

interface HistoryEntry {
  readonly label: string
  apply: () => void
  readonly invert: () => void
  /** Set on a change that later changes with the same key fold into. */
  readonly gesture?: unknown
  /** For a change: the fields as they were before it, which a fold extends. */
  readonly before?: Record<string, unknown>
}

/** The fields of a part an edit may change; absent ones are left alone. */
export type PartChange = Partial<Pick<Part, "origin" | "orientation" | "shape" | "combine" | "softness" | "colour" | "opacity">>

export interface ModelStore {
  readonly parts: Accessor<readonly Part[]>
  readonly selected: Accessor<string | undefined>
  readonly canUndo: Accessor<boolean>
  readonly canRedo: Accessor<boolean>
  readonly part: (id: string) => Part | undefined
  readonly select: (id: string | undefined) => void
  /** An id no part holds and none this session was handed. */
  readonly nextId: () => string
  readonly add: (part: Part) => boolean
  readonly remove: (id: string) => boolean
  /**
   * Edits a part. Changes passing the same `gesture` (any value, one per
   * drag) fold into one history entry, so a colour dragged across the
   * picker is one undo step rather than one per pointer move.
   */
  readonly change: (id: string, change: PartChange, gesture?: unknown) => boolean
  /** Replaces the whole model as one undoable step (open, new, restore). */
  readonly load: (parts: readonly Part[], label: string) => boolean
  readonly undo: () => void
  readonly redo: () => void
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

export const createModelStore = (initial: readonly Part[] = []): ModelStore => {
  let model: readonly Part[] = [...initial]
  let selection: string | undefined = initial[0]?.id
  let undoStack: HistoryEntry[] = []
  let redoStack: HistoryEntry[] = []
  let handed = 1

  let [parts, setParts] = createSignal<readonly Part[]>(model)
  let [selected, setSelected] = createSignal<string | undefined>(selection)
  let [canUndo, setCanUndo] = createSignal(false)
  let [canRedo, setCanRedo] = createSignal(false)

  let write = (next: readonly Part[]) => {
    model = next
    setParts(next)
  }
  let choose = (id: string | undefined) => {
    selection = id
    setSelected(id)
  }
  let publishHistory = () => {
    setCanUndo(undoStack.length > 0)
    setCanRedo(redoStack.length > 0)
  }
  let record = (entry: HistoryEntry) => {
    undoStack.push(entry)
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
    redoStack = []
    publishHistory()
  }
  let patch = (id: string, fields: PartChange) => write(model.map(part => (part.id === id ? { ...part, ...fields } : part)))

  return {
    parts,
    selected,
    canUndo,
    canRedo,
    part: id => parts().find(part => part.id === id),

    select: id => choose(id !== undefined && model.some(part => part.id === id) ? id : undefined),

    nextId: () => {
      let candidate = `part-${handed++}`
      while (model.some(part => part.id === candidate)) candidate = `part-${handed++}`
      return candidate
    },

    add: part => {
      if (model.length >= MAX_PARTS || model.some(existing => existing.id === part.id)) return false
      let apply = () => {
        write([...model, part])
        choose(part.id)
      }
      apply()
      record({
        label: `add ${part.id}`,
        apply,
        invert: () => {
          write(model.filter(existing => existing.id !== part.id))
          choose(undefined)
        },
      })
      return true
    },

    remove: id => {
      let index = model.findIndex(part => part.id === id)
      if (index < 0) return false
      let existing = model[index]!
      let wasSelected = selection === id
      let apply = () => {
        write(model.filter(part => part.id !== id))
        if (selection === id) choose(undefined)
      }
      apply()
      record({
        label: `remove ${id}`,
        apply,
        invert: () => {
          let next = [...model]
          next.splice(Math.min(index, next.length), 0, existing)
          write(next)
          if (wasSelected) choose(id)
        },
      })
      return true
    },

    change: (id, change, gesture) => {
      let existing = model.find(part => part.id === id)
      if (existing === undefined) return false
      let before: Record<string, unknown> = {}
      let after: Record<string, unknown> = {}
      for (let key of Object.keys(change) as (keyof PartChange)[]) {
        if (same(existing[key], change[key])) continue
        before[key] = existing[key]
        after[key] = change[key]
      }
      if (Object.keys(after).length === 0) return false
      patch(id, after)
      let last = undoStack[undoStack.length - 1]
      if (gesture !== undefined && redoStack.length === 0 && last?.gesture === gesture && last.before !== undefined) {
        // The entry keeps the state before the gesture began and replays where it ended.
        for (let key of Object.keys(before)) if (!(key in last.before)) last.before[key] = before[key]
        let replay = last.apply
        last.apply = () => {
          replay()
          patch(id, after)
        }
        return true
      }
      record({ label: `change ${id}`, apply: () => patch(id, after), invert: () => patch(id, before), gesture, before })
      return true
    },

    load: (incoming, label) => {
      if (incoming.length > MAX_PARTS || new Set(incoming.map(part => part.id)).size !== incoming.length) return false
      let before = model
      let wasSelected = selection
      let next = [...incoming]
      let apply = () => {
        write(next)
        choose(next[0]?.id)
      }
      apply()
      record({
        label,
        apply,
        invert: () => {
          write(before)
          choose(wasSelected)
        },
      })
      return true
    },

    undo: () => {
      let entry = undoStack.pop()
      if (entry === undefined) return
      entry.invert()
      redoStack.push(entry)
      publishHistory()
    },

    redo: () => {
      let entry = redoStack.pop()
      if (entry === undefined) return
      entry.apply()
      undoStack.push(entry)
      publishHistory()
    },
  }
}

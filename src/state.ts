// What the window and the screens share. Key events bubble to the window
// when nothing focused takes them, so the window owns the shortcut point
// and the screen that is showing registers what its shortcuts do.

import type { KeyEvent } from "@solidrt/core"

let shortcuts: ((event: KeyEvent) => void) | undefined

/** The window's key handler: hands the event to the screen's shortcuts, if any. */
export const onWindowKey = (event: KeyEvent): void => shortcuts?.(event)

/** Makes `handler` the app's shortcuts until the returned cleanup runs. */
export const registerShortcuts = (handler: (event: KeyEvent) => void): (() => void) => {
  shortcuts = handler
  return () => {
    if (shortcuts === handler) shortcuts = undefined
  }
}

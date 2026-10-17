// Where the document being edited lives, if it lives anywhere yet: one
// union, so a name and a place cannot drift apart. "nowhere" is a state
// (a new document, a restored draft): the next Save asks where to write.
// A place is a path `file()` opens again (a content:// URI on Android).

export type Home = { readonly kind: "nowhere" } | { readonly kind: "file"; readonly path: string; readonly name: string }

export const NOWHERE: Home = { kind: "nowhere" }

/** What to call the document as things stand, for a title or a save dialog. */
export const homeName = (home: Home): string => (home.kind === "nowhere" ? "model" : home.name)

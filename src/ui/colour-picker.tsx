// An HSVA colour picker: a hue-by-saturation field darkened by the value,
// a value strip and an alpha strip, and the four channels as numbers.
// Ported from upstream's colour-picker.tsx (itself rm-stacker's). Laid out.
//
// The picker keeps its own HSVA, derived from the colour it is shown, so a
// grey or black does not forget the hue it was dragged from.

import { arena, createLinearGradient, createMemo, createSignal, For, onSettled, type PointerEvent } from "@solidrt/core"
import { Text, View } from "@solidrt/components"
import { hsvaToRgba, rgbaToCss, rgbaToHsva, sameRgba, type HSVA } from "../model/colour"
import type { RGBA } from "../model/types"
import { NumberField } from "./bits"

const FIELD_WIDTH = 176
const FIELD_HEIGHT = 128
const STRIP_WIDTH = 22

const HUES = createLinearGradient(0, 0, 1, 0, ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"].map((color, i) => ({ offset: i / 6, color })))
const SATURATION = createLinearGradient(0, 0, 0, 1, [
  { offset: 0, color: "rgba(255,255,255,0)" },
  { offset: 1, color: "rgba(255,255,255,1)" },
])

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

/**
 * Pointer handling for one drag surface: a down claims the pointer outright
 * (a scrolling panel around it must not take the drag), and every move
 * reports the pointer as a fraction of the surface, clamped.
 */
const dragSurface = (width: number, height: number, onFraction: (x: number, y: number) => void, onEnd: () => void) => {
  let active: number | undefined
  let owner = {
    cancel: () => {
      active = undefined
      onEnd()
    },
  }
  let report = (e: PointerEvent) => onFraction(clamp01(e.localX / width), clamp01(e.localY / height))
  let end = (e: PointerEvent) => {
    if (active !== e.pointerId) return
    arena.release(e.pointerId, owner)
    active = undefined
    onEnd()
  }
  onSettled(() => () => {
    if (active !== undefined) arena.release(active, owner)
  })
  return {
    onPointerDown: (e: PointerEvent) => {
      if (active !== undefined) return
      arena.steal(e.pointerId, owner)
      active = e.pointerId
      report(e)
    },
    onPointerMove: (e: PointerEvent) => {
      if (active === e.pointerId) report(e)
    },
    onPointerUp: end,
    onPointerCancel: end,
  }
}

export function ColourPicker(props: {
  colour: RGBA
  /** Called on every change; `gesture` is the same value for the whole of one drag. */
  onColour: (colour: RGBA, gesture?: unknown) => void
}) {
  let [hsva, setHsva] = createSignal<HSVA>(
    previous => {
      let base = previous ?? { h: 0, s: 1, v: 1, a: 1 }
      if (previous !== undefined && sameRgba(hsvaToRgba(previous), props.colour)) return previous
      return rgbaToHsva(props.colour, base)
    },
    { equals: (a, b) => a.h === b.h && a.s === b.s && a.v === b.v && a.a === b.a },
  )
  let colour = createMemo(() => hsvaToRgba(hsva()))
  let gesture: object | undefined

  let update = (next: HSVA) => {
    setHsva(next)
    let rgba = hsvaToRgba(next)
    if (!sameRgba(rgba, props.colour)) props.onColour(rgba, gesture)
  }
  let surface = (width: number, height: number, change: (x: number, y: number, previous: HSVA) => HSVA) =>
    dragSurface(
      width,
      height,
      (x, y) => {
        gesture ??= {}
        update(change(x, y, hsva()))
      },
      () => (gesture = undefined),
    )

  let field = surface(FIELD_WIDTH, FIELD_HEIGHT, (x, y, previous) => ({ ...previous, h: x * 360, s: 1 - y }))
  let value = surface(STRIP_WIDTH, FIELD_HEIGHT, (_x, y, previous) => ({ ...previous, v: 1 - y }))
  let alpha = surface(STRIP_WIDTH, FIELD_HEIGHT, (_x, y, previous) => ({ ...previous, a: 1 - y }))

  let fullValue = () => rgbaToCss(hsvaToRgba({ ...hsva(), v: 1, a: 1 }))
  let opaque = () => rgbaToCss(hsvaToRgba({ ...hsva(), a: 1 }))

  return (
    <View layout={{ gap: 10 }}>
      <View layout={{ flexDirection: "row", gap: 8 }}>
        <view width={FIELD_WIDTH} height={FIELD_HEIGHT} {...field}>
          <d-rect color={HUES} radius={4} />
          <d-rect color={SATURATION} radius={4} />
          <d-rect color={`rgba(0,0,0,${1 - hsva().v})`} radius={4} />
          <d-oval x={(hsva().h / 360) * FIELD_WIDTH - 6} y={(1 - hsva().s) * FIELD_HEIGHT - 6} w={12} h={12} color="#ffffff" drawStyle="stroke" strokeWidth={2} />
        </view>
        <view width={STRIP_WIDTH} height={FIELD_HEIGHT} {...value}>
          <d-rect color={createLinearGradient(0, 0, 0, 1, [
            { offset: 0, color: fullValue() },
            { offset: 1, color: "#000000" },
          ])} radius={4} />
          <d-rect x={-2} y={(1 - hsva().v) * FIELD_HEIGHT - 2} w={STRIP_WIDTH + 4} h={4} color="#ffffff" radius={2} />
        </view>
        <view width={STRIP_WIDTH} height={FIELD_HEIGHT} {...alpha}>
          <Checkers width={STRIP_WIDTH} height={FIELD_HEIGHT} />
          <d-rect color={createLinearGradient(0, 0, 0, 1, [
            { offset: 0, color: opaque() },
            { offset: 1, color: "rgba(0,0,0,0)" },
          ])} radius={4} />
          <d-rect x={-2} y={(1 - hsva().a) * FIELD_HEIGHT - 2} w={STRIP_WIDTH + 4} h={4} color="#ffffff" radius={2} />
        </view>
      </View>
      <View layout={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <View layout={{ width: 36, height: 36 }}>
          <Checkers width={36} height={36} radius={6} />
          <d-rect color={rgbaToCss(colour())} radius={6} />
        </View>
        <View layout={{ flexGrow: 1, gap: 4 }}>
          <For each={["r", "g", "b", "a"] as const}>
            {channel => (
              <NumberField
                label={channel.toUpperCase()}
                labelWidth={14}
                digits={0}
                value={colour()[channel]}
                onCommit={typed => update(rgbaToHsva({ ...colour(), [channel]: Math.max(0, Math.min(255, Math.round(typed))) }, hsva()))}
              />
            )}
          </For>
        </View>
      </View>
      <Text variant="caption" muted>
        drag the field for hue and saturation, the strips for brightness and opacity
      </Text>
    </View>
  )
}

/**
 * A checkerboard behind translucent colour, so its opacity reads. Laid out
 * (absolute, filling a box of the given size), clipped to the rounded
 * corners the colour on top of it draws with.
 */
export function Checkers(props: { width: number; height: number; radius?: number }) {
  let size = 6
  let squares: { x: number; y: number }[] = []
  for (let y = 0; y < props.height; y += size) for (let x = (y / size) % 2 === 0 ? 0 : size; x < props.width; x += size * 2) squares.push({ x, y })
  return (
    <view position="absolute" left={0} top={0} width={props.width} height={props.height} overflow="hidden" clipRadius={props.radius ?? 4}>
      <d-rect color="#d8d8d8" />
      <For each={squares}>{square => <d-rect x={square.x} y={square.y} w={Math.min(size, props.width - square.x)} h={Math.min(size, props.height - square.y)} color="#9a9a9a" />}</For>
    </view>
  )
}

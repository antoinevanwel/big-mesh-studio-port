// The 3D view: the meshed model under an orbit camera, a translucent amber
// box around the selected part, the move tool's arrows or the rotate
// tool's rings on it, and the ghost a drag moves or turns before it is
// committed. Laid out (fills its parent).
//
// The camera's pointer feed is not handed to <Scene pointer>: the scene's
// root forwards each press to it here, unless the press took hold of a
// handle. Upstream's handles are grabbed in screen space (a fingertip's
// reach from the drawn arm or ring, even where it is inside the model), so
// a mesh claiming its own press is not enough; the gate is the root listener.

import { createEffect, createInputMap, createMemo, createPointerFeed, createSignal, displayScale, For, onBeforeRender, Show } from "@solidrt/core"
import { glsl } from "@solidrt/core/gpu"
import {
  box,
  cone,
  cylinder,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  OrbitCamera,
  orbitActions,
  orbitBindings,
  PerspectiveCamera,
  phong,
  premultipliedColor,
  Scene,
  setTransform,
  shaderMaterialClass,
  torus,
  unlit,
} from "@solidrt/3d"
import type { Geometry, MeshNode, OrbitCameraHandle, SceneHandle, SceneNode, ScenePointerEvent, SceneTapEvent } from "@solidrt/3d"
import { axisAngle, multiply, type Part } from "../model/part"
import { isAxial, primitiveHalfExtents } from "../model/primitives"
import type { Quat, Vec3 } from "../model/types"
import { armUnderPointer, AXES, distanceDragged, HEAD_LENGTH, HEAD_RADIUS, SHAFT_RADIUS, VIEW_SHARE, type ArmOnScreen, type Axis, type ScreenPoint } from "./move-handle"
import { AROUND, radiansDragged, RING_VIEW_SHARE, ringUnderPointer, TUBE_RADIUS, type RingOnScreen } from "./rotate-handle"

/** Vertices in @solidrt/3d's "colored" layout and their triangles. */
export interface DrawnMesh {
  readonly vertices: Float32Array
  readonly indices: Uint32Array
}

export type Tool = "select" | "move" | "rotate"

export interface ViewportProps {
  readonly mesh: (DrawnMesh & { readonly translucent: boolean }) | undefined
  /** Where to aim the camera and how big the model is; a change glides the view there. */
  readonly frame: { readonly centre: Vec3; readonly size: number } | undefined
  readonly part: Part | undefined
  readonly tool: Tool
  /** The part's own shape, at the origin and unturned. */
  readonly ghostFor: (part: Part) => Promise<DrawnMesh | null>
  /** A tap landed on the model at this world point, or on empty space (undefined); select tool only. */
  readonly onPick: (point: Vec3 | undefined) => void
  /** An arrow drag ended with the part somewhere new. */
  readonly onMove: (id: string, origin: Vec3) => void
  /** A ring drag ended with the part turned. */
  readonly onTurn: (id: string, orientation: Quat) => void
}

const AXIS_COLOUR: Record<Axis, [number, number, number]> = {
  x: [0xe0 / 255, 0x58 / 255, 0x4c / 255],
  y: [0x6f / 255, 0xbf / 255, 0x4a / 255],
  z: [0x4a / 255, 0x86 / 255, 0xe0 / 255],
}
/** The level editor's amber, translucent so the surface reads through it (upstream selection-box.ts). */
const HIGHLIGHT: [number, number, number, number] = [1, 0xe0 / 255, 0x66 / 255, 0.35]
const HELD_SCALE = 1.15
const HELD_RING_SCALE = 1.08
const SHAFT_LENGTH = 1 - HEAD_LENGTH
const MIN_DISTANCE = 0.4

const unit = (axis: Axis): Vec3 => (axis === "x" ? { x: 1, y: 0, z: 0 } : axis === "y" ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 })
// Each arm is built along +y and the torus lies across +y, so both are
// turned the same way onto their axis.
const ONTO_AXIS: Record<Axis, [number, number, number]> = { x: [0, 0, -Math.PI / 2], y: [0, 0, 0], z: [Math.PI / 2, 0, 0] }
/** Two unit directions spanning the plane a ring lies in. */
const RING_PLANE: Record<Axis, [Vec3, Vec3]> = {
  x: [unit("y"), unit("z")],
  y: [unit("z"), unit("x")],
  z: [unit("x"), unit("y")],
}

// Drawn over everything (no depth test) in the transparent queue, which
// draws after the model, as upstream's handles are.
const handleLook = shaderMaterialClass({
  label: "handle",
  vertex: glsl`
    in vec3 aPos;
    uniform mat4 uModel;
    uniform mat4 uViewProj;
    void main() {
      gl_Position = uViewProj * uModel * vec4(aPos, 1.0);
    }
  `,
  fragment: glsl`
    uniform vec4 uColor;
    void main() {
      fragColor = uColor;
    }
  `,
  depth: false,
  blend: "alpha",
})

/** Where the part is while a drag holds it: moved, or turned. */
type Pose = { readonly origin: Vec3; readonly orientation: Quat }

type Drag =
  | { readonly kind: "move"; readonly pointerId: number; readonly part: Part; readonly down: ScreenPoint; readonly arm: ArmOnScreen; readonly length: number }
  | { readonly kind: "turn"; readonly pointerId: number; readonly part: Part; readonly down: ScreenPoint; readonly ring: RingOnScreen }

export function Viewport(props: ViewportProps) {
  let scene: SceneHandle | undefined
  let orbit: OrbitCameraHandle | undefined
  let model: MeshNode | undefined
  let arrows: SceneNode | undefined
  let rings: SceneNode | undefined

  let pointer = createPointerFeed()
  let input = createInputMap(orbitActions)
  input.bind(orbitBindings({ pointer }))

  let solid = phong({ vertexColors: true, cull: "none", specular: 0.12, shininess: 24 })
  let glassy = phong({ vertexColors: true, cull: "none", specular: 0.12, shininess: 24, transparent: true })
  let ghostLook = unlit({ color: [1, 1, 1, 0.65], transparent: true })
  let highlightLook = unlit({ color: HIGHLIGHT, transparent: true })
  let unitBox = box({ label: "selection-box" })
  let shaft = cylinder({ radiusTop: SHAFT_RADIUS, radiusBottom: SHAFT_RADIUS, height: SHAFT_LENGTH, radialSegments: 8, label: "handle-shaft" })
  let tip = cone({ radius: HEAD_RADIUS, height: HEAD_LENGTH, radialSegments: 10, label: "handle-tip" })
  let ring = torus({ radius: 1, tube: TUBE_RADIUS, radialSegments: 8, tubularSegments: AROUND, label: "handle-ring" })
  let axisLook = Object.fromEntries(AXES.map(axis => [axis, handleLook.instance({ params: { uColor: premultipliedColor(AXIS_COLOUR[axis]) } })])) as Record<Axis, ReturnType<typeof handleLook.instance>>

  let geometry = createMemo((): Geometry | undefined =>
    props.mesh === undefined ? undefined : { vertices: props.mesh.vertices, indices: props.mesh.indices, layout: "colored", label: "model" },
  )

  let drag: Drag | undefined
  let [held, setHeld] = createSignal<Axis | undefined>()
  let [pose, setPose] = createSignal<Pose | undefined>()
  let [ghost, setGhost] = createSignal<Geometry | undefined>()

  let showArrows = createMemo(() => props.tool === "move" && props.part !== undefined)
  // Turning a sphere, an ellipsoid or a round box changes nothing, so they get no rings.
  let showRings = createMemo(() => props.tool === "rotate" && props.part !== undefined && isAxial(props.part.shape.type))
  let distance = () => orbit?.pose().distance ?? 6

  // The handles keep their size on screen: re-placed before each frame
  // while shown, which costs nothing when nothing is moving (no frame runs).
  createEffect(
    () => showArrows() || showRings(),
    shown => {
      if (!shown) return
      return onBeforeRender(() => {
        let at = pose()?.origin ?? props.part?.origin
        if (at === undefined) return
        if (arrows !== undefined) setTransform(arrows, { position: [at.x, at.y, at.z], scale: VIEW_SHARE * distance() })
        if (rings !== undefined) setTransform(rings, { position: [at.x, at.y, at.z], scale: RING_VIEW_SHARE * distance() })
      })
    },
  )

  let armsOnScreen = (origin: Vec3, length: number): ArmOnScreen[] => {
    if (scene === undefined) return []
    let from = scene.project([origin.x, origin.y, origin.z])
    if (from === null) return []
    let arms: ArmOnScreen[] = []
    for (let axis of AXES) {
      let u = unit(axis)
      let to = scene.project([origin.x + u.x * length, origin.y + u.y * length, origin.z + u.z * length])
      if (to !== null) arms.push({ axis, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } })
    }
    return arms
  }

  let ringsOnScreen = (origin: Vec3, radius: number): RingOnScreen[] => {
    if (scene === undefined) return []
    let middle = scene.project([origin.x, origin.y, origin.z])
    if (middle === null) return []
    let eye = scene.camera().position
    let found: RingOnScreen[] = []
    for (let axis of AXES) {
      let [a, b] = RING_PLANE[axis]
      let around: ScreenPoint[] = []
      for (let step = 0; step < AROUND; step++) {
        let angle = (step / AROUND) * 2 * Math.PI
        let c = Math.cos(angle) * radius
        let s = Math.sin(angle) * radius
        let at = scene.project([origin.x + a.x * c + b.x * s, origin.y + a.y * c + b.y * s, origin.z + a.z * c + b.z * s])
        if (at !== null) around.push({ x: at.x, y: at.y })
      }
      if (around.length < 3) continue
      let u = unit(axis)
      let facing = u.x * (eye[0] - origin.x) + u.y * (eye[1] - origin.y) + u.z * (eye[2] - origin.z) > 0
      found.push({ axis, middle: { x: middle.x, y: middle.y }, around, facing })
    }
    return found
  }

  // A press on a handle starts a drag and never reaches the camera.
  let grab = (e: ScenePointerEvent): boolean => {
    let part = props.part
    if (part === undefined || drag !== undefined) return false
    let down = { x: e.x, y: e.y }
    if (showArrows()) {
      let length = VIEW_SHARE * distance()
      let arms = armsOnScreen(part.origin, length)
      let axis = armUnderPointer(down, arms, displayScale())
      let arm = arms.find(candidate => candidate.axis === axis)
      if (axis === undefined || arm === undefined) return false
      drag = { kind: "move", pointerId: e.pointerId, part, down, arm, length }
      setHeld(axis)
    } else if (showRings()) {
      let onScreen = ringsOnScreen(part.origin, RING_VIEW_SHARE * distance())
      let axis = ringUnderPointer(down, onScreen, displayScale())
      let ring = onScreen.find(candidate => candidate.axis === axis)
      if (axis === undefined || ring === undefined) return false
      drag = { kind: "turn", pointerId: e.pointerId, part, down, ring }
      setHeld(axis)
    } else return false
    setPose({ origin: part.origin, orientation: part.orientation })
    void props.ghostFor(part).then(mesh => {
      if (drag?.part !== part || mesh === null) return
      setGhost({ vertices: mesh.vertices, indices: mesh.indices, layout: "colored", label: "ghost" })
    })
    return true
  }

  let follow = (e: ScenePointerEvent) => {
    if (drag === undefined) return
    let { part } = drag
    if (drag.kind === "move") {
      let along = distanceDragged({ x: e.x - drag.down.x, y: e.y - drag.down.y }, drag.arm, drag.length, displayScale())
      let u = unit(drag.arm.axis)
      setPose({ origin: { x: part.origin.x + u.x * along, y: part.origin.y + u.y * along, z: part.origin.z + u.z * along }, orientation: part.orientation })
    } else {
      // A turn about the world axis, before whatever turn the part already had.
      let u = unit(drag.ring.axis)
      let turn = axisAngle(u.x, u.y, u.z, radiansDragged(drag.down, { x: e.x, y: e.y }, drag.ring))
      setPose({ origin: part.origin, orientation: multiply(turn, part.orientation) })
    }
  }

  let release = (commit: boolean) => {
    if (drag === undefined) return
    let { part, kind } = drag
    let to = pose()
    drag = undefined
    setHeld(undefined)
    setPose(undefined)
    setGhost(undefined)
    if (!commit || to === undefined) return
    if (kind === "move" && (to.origin.x !== part.origin.x || to.origin.y !== part.origin.y || to.origin.z !== part.origin.z)) props.onMove(part.id, to.origin)
    if (kind === "turn" && to.orientation !== part.orientation) props.onTurn(part.id, to.orientation)
  }

  // Glide to each new framing rather than jumping; the first one snaps.
  let framed = false
  createEffect(
    () => props.frame,
    frame => {
      if (frame === undefined || orbit === undefined) return
      let pose = { target: [frame.centre.x, frame.centre.y, frame.centre.z] as [number, number, number], distance: Math.min(400, Math.max(MIN_DISTANCE, Math.max(frame.size, MIN_DISTANCE * 4) * 1.8)) }
      if (framed) orbit.glideTo(pose)
      else orbit.set(pose)
      framed = true
    },
  )

  return (
    <Scene
      label="modeller"
      clearColor={[0x11 / 255, 0x11 / 255, 0x14 / 255, 1]}
      ref={s => (scene = s)}
      onPointerDown={e => {
        if (!grab(e)) pointer.handlers.onPointerDown(e.native)
      }}
      onPointerMove={e => {
        if (drag?.pointerId === e.pointerId) follow(e)
        else pointer.handlers.onPointerMove(e.native)
      }}
      onPointerUp={e => {
        if (drag?.pointerId === e.pointerId) release(true)
        else pointer.handlers.onPointerUp(e.native)
      }}
      onPointerCancel={e => {
        if (drag?.pointerId === e.pointerId) release(false)
        else pointer.handlers.onPointerCancel(e.native)
      }}
      onWheel={e => pointer.handlers.onWheel(e.native)}
      onTap={(e: SceneTapEvent) => {
        if (props.tool !== "select" || scene === undefined) return
        // Every hit along the ray, so a tap through the selection box still reaches the model.
        let hit = scene.pick(e.x, e.y).find(candidate => candidate.mesh === model)
        props.onPick(hit === undefined ? undefined : { x: hit.point[0], y: hit.point[1], z: hit.point[2] })
      }}
    >
      <PerspectiveCamera fov={45} near={0.01} far={1000} />
      <OrbitCamera input={input} azimuth={0.6} elevation={0.47} distance={6} minDistance={MIN_DISTANCE} maxDistance={400} ref={o => (orbit = o)} />
      {/* Upstream's key and fill: a warm light from above right, a cool one from behind left. */}
      <DirectionalLight direction={[-0.51, -0.79, -0.56]} color={[1, 0.97, 0.92]} intensity={1.25} />
      <DirectionalLight direction={[0.78, -0.21, 0.58]} color={[0.66, 0.76, 1]} intensity={0.45} />
      <HemisphereLight sky={[0.36, 0.38, 0.44]} ground={[0.22, 0.22, 0.26]} intensity={1} />

      <Show when={geometry()}>
        {g => <Mesh geometry={g()} material={props.mesh?.translucent ? glassy : solid} ref={m => (model = m)} />}
      </Show>

      {/* The primitive's own extent, turned with the part, and drawn after the model so it covers the surface it marks. */}
      <Show when={props.part}>
        {part => {
          let at = () => pose()?.origin ?? part().origin
          let q = () => pose()?.orientation ?? part().orientation
          let size = () => primitiveHalfExtents(part().shape)
          return (
            <Mesh
              geometry={unitBox}
              material={highlightLook}
              position={[at().x, at().y, at().z]}
              quaternion={[q().x, q().y, q().z, q().w]}
              scale={[Math.max(2 * size().x, 0.001), Math.max(2 * size().y, 0.001), Math.max(2 * size().z, 0.001)]}
              renderOrder={5}
            />
          )
        }}
      </Show>

      <Show when={ghost()}>
        {g => {
          let at = () => pose()?.origin ?? { x: 0, y: 0, z: 0 }
          let q = () => pose()?.orientation ?? { x: 0, y: 0, z: 0, w: 1 }
          return <Mesh geometry={g()} material={ghostLook} position={[at().x, at().y, at().z]} quaternion={[q().x, q().y, q().z, q().w]} />
        }}
      </Show>

      <Show when={showArrows()}>
        <Group ref={g => (arrows = g)}>
          <For each={AXES}>
            {axis => (
              <Group rotation={ONTO_AXIS[axis]} scale={held() === axis ? HELD_SCALE : 1}>
                <Mesh geometry={shaft} material={axisLook[axis]} position={[0, SHAFT_LENGTH / 2, 0]} renderOrder={10} />
                <Mesh geometry={tip} material={axisLook[axis]} position={[0, SHAFT_LENGTH + HEAD_LENGTH / 2, 0]} renderOrder={10} />
              </Group>
            )}
          </For>
        </Group>
      </Show>

      <Show when={showRings()}>
        <Group ref={g => (rings = g)}>
          <For each={AXES}>
            {axis => <Mesh geometry={ring} material={axisLook[axis]} rotation={ONTO_AXIS[axis]} scale={held() === axis ? HELD_RING_SCALE : 1} renderOrder={10} />}
          </For>
        </Group>
      </Show>
    </Scene>
  )
}

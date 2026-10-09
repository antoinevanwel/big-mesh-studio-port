// The 3D view: the meshed model under an orbit camera, the move tool's
// arrows on the selected part, and the ghost a drag moves before it is
// committed. Laid out (fills its parent).
//
// The camera's pointer feed is not handed to <Scene pointer>: the scene's
// root forwards each press to it here, unless the press took hold of an
// arrow. Upstream's arrows are grabbed in screen space (a fingertip's reach
// from the drawn arm, even where the arm is inside the model), so a mesh
// claiming its own press is not enough; the gate is the root listener.

import { createEffect, createInputMap, createMemo, createPointerFeed, createSignal, displayScale, For, onBeforeRender, Show } from "@solidrt/core"
import { glsl } from "@solidrt/core/gpu"
import {
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
  unlit,
} from "@solidrt/3d"
import type { Geometry, MeshNode, OrbitCameraHandle, SceneHandle, SceneNode, ScenePointerEvent, SceneTapEvent } from "@solidrt/3d"
import type { Part } from "../model/part"
import type { Vec3 } from "../model/types"
import { armUnderPointer, AXES, distanceDragged, HEAD_LENGTH, HEAD_RADIUS, SHAFT_RADIUS, VIEW_SHARE, type ArmOnScreen, type Axis } from "./move-handle"

/** Vertices in @solidrt/3d's "colored" layout and their triangles. */
export interface DrawnMesh {
  readonly vertices: Float32Array
  readonly indices: Uint32Array
}

export interface ViewportProps {
  readonly mesh: (DrawnMesh & { readonly translucent: boolean }) | undefined
  /** Where to aim the camera and how big the model is; a change glides the view there. */
  readonly frame: { readonly centre: Vec3; readonly size: number } | undefined
  readonly part: Part | undefined
  readonly tool: "select" | "move"
  readonly ghostFor: (part: Part) => Promise<DrawnMesh | null>
  /** A tap landed on the model at this world point (select tool). */
  readonly onPick: (point: Vec3) => void
  /** An arrow drag ended with the part somewhere new. */
  readonly onMove: (id: string, origin: Vec3) => void
}

const AXIS_COLOUR: Record<Axis, [number, number, number]> = {
  x: [0xe0 / 255, 0x58 / 255, 0x4c / 255],
  y: [0x6f / 255, 0xbf / 255, 0x4a / 255],
  z: [0x4a / 255, 0x86 / 255, 0xe0 / 255],
}
const HELD_SCALE = 1.15
const SHAFT_LENGTH = 1 - HEAD_LENGTH
const MIN_DISTANCE = 0.4

const unit = (axis: Axis): Vec3 => (axis === "x" ? { x: 1, y: 0, z: 0 } : axis === "y" ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 })
// Each arm is built along +y and turned onto its axis.
const ARM_ROTATION: Record<Axis, [number, number, number]> = { x: [0, 0, -Math.PI / 2], y: [0, 0, 0], z: [Math.PI / 2, 0, 0] }

// Drawn over everything (no depth test) in the transparent queue, which
// draws after the model, as upstream's arrows are.
const handleLook = shaderMaterialClass({
  label: "move-handle",
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

export function Viewport(props: ViewportProps) {
  let scene: SceneHandle | undefined
  let orbit: OrbitCameraHandle | undefined
  let model: MeshNode | undefined
  let arrows: SceneNode | undefined

  let pointer = createPointerFeed()
  let input = createInputMap(orbitActions)
  input.bind(orbitBindings({ pointer }))

  let solid = phong({ vertexColors: true, cull: "none", specular: 0.12, shininess: 24 })
  let glassy = phong({ vertexColors: true, cull: "none", specular: 0.12, shininess: 24, transparent: true })
  let ghostLook = unlit({ color: [1, 1, 1, 0.65], transparent: true })
  let shaft = cylinder({ radiusTop: SHAFT_RADIUS, radiusBottom: SHAFT_RADIUS, height: SHAFT_LENGTH, radialSegments: 8, label: "handle-shaft" })
  let tip = cone({ radius: HEAD_RADIUS, height: HEAD_LENGTH, radialSegments: 10, label: "handle-tip" })
  let armLook = Object.fromEntries(AXES.map(axis => [axis, handleLook.instance({ params: { uColor: premultipliedColor(AXIS_COLOUR[axis]) } })])) as Record<Axis, ReturnType<typeof handleLook.instance>>

  let geometry = createMemo((): Geometry | undefined =>
    props.mesh === undefined ? undefined : { vertices: props.mesh.vertices, indices: props.mesh.indices, layout: "colored", label: "model" },
  )

  // A drag in progress: the arm held, where the part started, where the pointer went down.
  type Drag = { pointerId: number; axis: Axis; arm: ArmOnScreen; length: number; part: Part; downX: number; downY: number }
  let drag: Drag | undefined
  let [held, setHeld] = createSignal<Axis | undefined>()
  let [moved, setMoved] = createSignal<Vec3 | undefined>()
  let [ghost, setGhost] = createSignal<Geometry | undefined>()

  let showArrows = createMemo(() => props.tool === "move" && props.part !== undefined)
  let armLength = () => VIEW_SHARE * (orbit?.pose().distance ?? 6)

  // The arrows keep their size on screen: re-placed before each frame while
  // shown, which costs nothing when nothing is moving (no frame runs).
  createEffect(showArrows, shown => {
    if (!shown) return
    return onBeforeRender(() => {
      let at = moved() ?? props.part?.origin
      if (arrows === undefined || at === undefined) return
      setTransform(arrows, { position: [at.x, at.y, at.z], scale: armLength() })
    })
  })

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

  // A press on an arm starts a drag and never reaches the camera.
  let grab = (e: ScenePointerEvent): boolean => {
    let part = props.part
    if (!showArrows() || part === undefined || drag !== undefined) return false
    let length = armLength()
    let arms = armsOnScreen(part.origin, length)
    let axis = armUnderPointer({ x: e.x, y: e.y }, arms, displayScale())
    let arm = arms.find(candidate => candidate.axis === axis)
    if (axis === undefined || arm === undefined) return false
    drag = { pointerId: e.pointerId, axis, arm, length, part, downX: e.x, downY: e.y }
    setHeld(axis)
    setMoved(part.origin)
    void props.ghostFor(part).then(mesh => {
      if (drag?.part !== part || mesh === null) return
      setGhost({ vertices: mesh.vertices, indices: mesh.indices, layout: "colored", label: "ghost" })
    })
    return true
  }

  let follow = (e: ScenePointerEvent) => {
    if (drag === undefined) return
    let along = distanceDragged({ x: e.x - drag.downX, y: e.y - drag.downY }, drag.arm, drag.length, displayScale())
    let u = unit(drag.axis)
    let start = drag.part.origin
    setMoved({ x: start.x + u.x * along, y: start.y + u.y * along, z: start.z + u.z * along })
  }

  let release = (commit: boolean) => {
    if (drag === undefined) return
    let { part } = drag
    let to = moved()
    drag = undefined
    setHeld(undefined)
    setMoved(undefined)
    setGhost(undefined)
    if (commit && to !== undefined && (to.x !== part.origin.x || to.y !== part.origin.y || to.z !== part.origin.z)) props.onMove(part.id, to)
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
        if (props.tool !== "select" || e.mesh === null || e.mesh !== model || e.point === null) return
        props.onPick({ x: e.point[0], y: e.point[1], z: e.point[2] })
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

      <Show when={ghost()}>
        {g => {
          let at = () => moved() ?? { x: 0, y: 0, z: 0 }
          return <Mesh geometry={g()} material={ghostLook} position={[at().x, at().y, at().z]} />
        }}
      </Show>

      <Show when={showArrows()}>
        <Group ref={g => (arrows = g)}>
          <For each={AXES}>
            {axis => (
              <Group rotation={ARM_ROTATION[axis]} scale={held() === axis ? HELD_SCALE : 1}>
                <Mesh geometry={shaft} material={armLook[axis]} position={[0, SHAFT_LENGTH / 2, 0]} renderOrder={10} />
                <Mesh geometry={tip} material={armLook[axis]} position={[0, SHAFT_LENGTH + HEAD_LENGTH / 2, 0]} renderOrder={10} />
              </Group>
            )}
          </For>
        </Group>
      </Show>
    </Scene>
  )
}

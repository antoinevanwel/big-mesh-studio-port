// The primitive table: nine closed signed-distance shapes, each one entry
// (its parameters, its bounds, its distance function and its file code).
// Ported from big-mesh-studios' packages/sdf. Every axial shape runs along
// Y, so a part's orientation is what lays a capsule down.
//
// The distance functions take the sample as three numbers rather than a
// vector object: the mesher calls them hundreds of thousands of times per
// rebuild in an interpreter, and an allocation per call is most of the cost.

import type { Vec3 } from "./types"

export type OperationShape =
  | { readonly type: "Sphere"; readonly radius: number }
  | { readonly type: "Ellipsoid"; readonly radius: Vec3 }
  | { readonly type: "Box"; readonly len: Vec3 }
  | { readonly type: "RoundBox"; readonly len: Vec3; readonly radius: number }
  | { readonly type: "Capsule"; readonly len: number; readonly radius: number }
  | { readonly type: "Cone"; readonly len: number; readonly radius: number }
  | { readonly type: "Cylinder"; readonly len: number; readonly radius: number }
  | { readonly type: "Torus"; readonly majorRadius: number; readonly minorRadius: number }
  | { readonly type: "HexPrism"; readonly len: number; readonly radius: number }

export type ShapeType = OperationShape["type"]

/** A distance function with its parameters baked in. */
export type Distance = (x: number, y: number, z: number) => number

/** The smallest radius a shape is evaluated at, so a zero never divides. */
export const MIN_RADIUS = 1e-3

const radius = (value: number): number => (value < MIN_RADIUS ? MIN_RADIUS : value)

const SIN_60 = 0.8660254037844387
const TAN_30 = 0.5773502691896258

export const sdSphere = (r: number, x: number, y: number, z: number): number => Math.sqrt(x * x + y * y + z * z) - radius(r)

export const sdEllipsoid = (radii: Vec3, x: number, y: number, z: number): number => {
  let rx = radius(radii.x)
  let ry = radius(radii.y)
  let rz = radius(radii.z)
  let ax = x / rx
  let ay = y / ry
  let az = z / rz
  let k0 = Math.sqrt(ax * ax + ay * ay + az * az)
  let bx = ax / rx
  let by = ay / ry
  let bz = az / rz
  let k1 = Math.sqrt(bx * bx + by * by + bz * bz)
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1
}

export const sdBox = (len: Vec3, x: number, y: number, z: number): number => {
  let dx = Math.abs(x) - len.x
  let dy = Math.abs(y) - len.y
  let dz = Math.abs(z) - len.z
  let ox = dx > 0 ? dx : 0
  let oy = dy > 0 ? dy : 0
  let oz = dz > 0 ? dz : 0
  let inside = Math.max(dx, dy, dz)
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + (inside < 0 ? inside : 0)
}

export const sdRoundBox = (len: Vec3, r: number, x: number, y: number, z: number): number => {
  let fillet = radius(r)
  let qx = Math.abs(x) - len.x + fillet
  let qy = Math.abs(y) - len.y + fillet
  let qz = Math.abs(z) - len.z + fillet
  let ox = qx > 0 ? qx : 0
  let oy = qy > 0 ? qy : 0
  let oz = qz > 0 ? qz : 0
  let inside = Math.max(qx, qy, qz)
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + (inside < 0 ? inside : 0) - fillet
}

export const sdCapsule = (len: number, r: number, x: number, y: number, z: number): number => {
  let half = radius(len) / 2
  let along = y < -half ? -half : y > half ? half : y
  let dy = y - along
  return Math.sqrt(x * x + dy * dy + z * z) - radius(r)
}

// A capped cone standing on its base: radius `r` at y = -len/2 tapering to
// a point at y = +len/2 (iq's sdCappedCone with a zero top radius).
export const sdCone = (len: number, r: number, x: number, y: number, z: number): number => {
  let half = radius(len) / 2
  let base = radius(r)
  let qx = Math.sqrt(x * x + z * z)
  let qy = y
  let capR = qy < 0 ? base : 0
  let cax = qx - Math.min(qx, capR)
  let cay = Math.abs(qy) - half
  let k2x = -base
  let k2y = 2 * half
  let t = (-qx * k2x + (half - qy) * k2y) / (k2x * k2x + k2y * k2y)
  let clamped = t < 0 ? 0 : t > 1 ? 1 : t
  let cbx = qx + k2x * clamped
  let cby = qy - half + k2y * clamped
  let sign = cbx < 0 && cay < 0 ? -1 : 1
  return sign * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby))
}

export const sdCylinder = (len: number, r: number, x: number, y: number, z: number): number => {
  let half = radius(len) / 2
  let radial = Math.sqrt(x * x + z * z) - radius(r)
  let axial = Math.abs(y) - half
  let or = radial > 0 ? radial : 0
  let oa = axial > 0 ? axial : 0
  return Math.min(Math.max(radial, axial), 0) + Math.sqrt(or * or + oa * oa)
}

export const sdTorus = (major: number, minor: number, x: number, y: number, z: number): number => {
  let ring = Math.sqrt(x * x + z * z) - radius(major)
  return Math.sqrt(ring * ring + y * y) - radius(minor)
}

// A hexagonal prism along Y; `r` is the circumradius of the hexagon.
export const sdHexPrism = (len: number, r: number, x: number, y: number, z: number): number => {
  let half = radius(len) / 2
  let inradius = radius(r) * SIN_60
  let ax = Math.abs(x)
  let az = Math.abs(z)
  let dot = -SIN_60 * ax + 0.5 * az
  let fold = dot < 0 ? -2 * dot : 0
  let fx = ax - SIN_60 * fold
  let fz = az + 0.5 * fold
  let rx = fx - Math.min(Math.max(fx, -TAN_30 * inradius), TAN_30 * inradius)
  let rz = fz - inradius
  let radial = Math.sqrt(rx * rx + rz * rz) * (fz < inradius ? -1 : 1)
  let axial = Math.abs(y) - half
  let or = radial > 0 ? radial : 0
  let oa = axial > 0 ? axial : 0
  return Math.min(Math.max(radial, axial), 0) + Math.sqrt(or * or + oa * oa)
}

/** One parameter of a primitive, as the transform panel shows it. */
export interface PrimitiveParameter {
  readonly name: string
  readonly arity: 1 | 3
  readonly label: string
  readonly axes?: readonly [string, string, string]
  readonly min: number
  readonly step: number
}

interface PrimitiveSpec {
  readonly code: number
  readonly parameters: readonly PrimitiveParameter[]
  readonly halfExtents: (shape: any) => Vec3
  readonly compile: (shape: any) => Distance
}

const SIZE_AXES = ["Width", "Height", "Depth"] as const

// The codes are the file format's and must never change.
const PRIMITIVES: Record<ShapeType, PrimitiveSpec> = {
  Sphere: {
    code: 3,
    parameters: [{ name: "radius", arity: 1, label: "Radius", min: 0, step: 0.01 }],
    halfExtents: (s: { radius: number }) => ({ x: s.radius, y: s.radius, z: s.radius }),
    compile: (s: { radius: number }) => (x, y, z) => sdSphere(s.radius, x, y, z),
  },
  Ellipsoid: {
    code: 0,
    parameters: [{ name: "radius", arity: 3, label: "Radius", axes: SIZE_AXES, min: 0, step: 0.01 }],
    halfExtents: (s: { radius: Vec3 }) => s.radius,
    compile: (s: { radius: Vec3 }) => (x, y, z) => sdEllipsoid(s.radius, x, y, z),
  },
  Box: {
    code: 1,
    parameters: [{ name: "len", arity: 3, label: "Size", axes: SIZE_AXES, min: 0, step: 0.05 }],
    halfExtents: (s: { len: Vec3 }) => s.len,
    compile: (s: { len: Vec3 }) => (x, y, z) => sdBox(s.len, x, y, z),
  },
  RoundBox: {
    code: 4,
    parameters: [
      { name: "len", arity: 3, label: "Size", axes: SIZE_AXES, min: 0, step: 0.05 },
      { name: "radius", arity: 1, label: "Corner", min: 0, step: 0.01 },
    ],
    halfExtents: (s: { len: Vec3; radius: number }) => ({ x: s.len.x + s.radius, y: s.len.y + s.radius, z: s.len.z + s.radius }),
    compile: (s: { len: Vec3; radius: number }) => (x, y, z) => sdRoundBox(s.len, s.radius, x, y, z),
  },
  Capsule: {
    code: 2,
    parameters: [
      { name: "len", arity: 1, label: "Length", min: 0, step: 0.05 },
      { name: "radius", arity: 1, label: "Radius", min: 0, step: 0.01 },
    ],
    halfExtents: (s: { len: number; radius: number }) => ({ x: s.radius, y: s.len / 2 + s.radius, z: s.radius }),
    compile: (s: { len: number; radius: number }) => (x, y, z) => sdCapsule(s.len, s.radius, x, y, z),
  },
  Cone: {
    code: 5,
    parameters: [
      { name: "len", arity: 1, label: "Height", min: 0, step: 0.05 },
      { name: "radius", arity: 1, label: "Radius", min: 0, step: 0.01 },
    ],
    halfExtents: (s: { len: number; radius: number }) => ({ x: s.radius, y: s.len / 2, z: s.radius }),
    compile: (s: { len: number; radius: number }) => (x, y, z) => sdCone(s.len, s.radius, x, y, z),
  },
  Cylinder: {
    code: 6,
    parameters: [
      { name: "len", arity: 1, label: "Height", min: 0, step: 0.05 },
      { name: "radius", arity: 1, label: "Radius", min: 0, step: 0.01 },
    ],
    halfExtents: (s: { len: number; radius: number }) => ({ x: s.radius, y: s.len / 2, z: s.radius }),
    compile: (s: { len: number; radius: number }) => (x, y, z) => sdCylinder(s.len, s.radius, x, y, z),
  },
  Torus: {
    code: 7,
    parameters: [
      { name: "majorRadius", arity: 1, label: "Major radius", min: 0, step: 0.01 },
      { name: "minorRadius", arity: 1, label: "Minor radius", min: 0, step: 0.01 },
    ],
    halfExtents: (s: { majorRadius: number; minorRadius: number }) => ({
      x: s.majorRadius + s.minorRadius,
      y: s.minorRadius,
      z: s.majorRadius + s.minorRadius,
    }),
    compile: (s: { majorRadius: number; minorRadius: number }) => (x, y, z) => sdTorus(s.majorRadius, s.minorRadius, x, y, z),
  },
  HexPrism: {
    code: 8,
    parameters: [
      { name: "len", arity: 1, label: "Height", min: 0, step: 0.05 },
      { name: "radius", arity: 1, label: "Radius", min: 0, step: 0.01 },
    ],
    halfExtents: (s: { len: number; radius: number }) => ({ x: s.radius, y: s.len / 2, z: s.radius }),
    compile: (s: { len: number; radius: number }) => (x, y, z) => sdHexPrism(s.len, s.radius, x, y, z),
  },
}

export const PRIMITIVE_NAMES = Object.keys(PRIMITIVES) as ShapeType[]

/** The shape's distance function, parameters baked in. */
export const compileShape = (shape: OperationShape): Distance => PRIMITIVES[shape.type].compile(shape)

export const sdShape = (shape: OperationShape, x: number, y: number, z: number): number => compileShape(shape)(x, y, z)

/** The half-extents of the shape's own axis-aligned box, unrotated. */
export const primitiveHalfExtents = (shape: OperationShape): Vec3 => PRIMITIVES[shape.type].halfExtents(shape)

export const primitiveCode = (type: ShapeType): number => PRIMITIVES[type].code

export const primitiveFromCode = (code: number): ShapeType | null => PRIMITIVE_NAMES.find(name => PRIMITIVES[name].code === code) ?? null

/** How many floats the shape's parameters take in a file. */
export const parameterFloats = (type: ShapeType): number => PRIMITIVES[type].parameters.reduce((sum, p) => sum + p.arity, 0)

export const parametersToFloats = (shape: OperationShape): number[] => {
  let values = shape as unknown as Record<string, unknown>
  let floats: number[] = []
  for (let parameter of PRIMITIVES[shape.type].parameters) {
    let value = values[parameter.name]
    if (parameter.arity === 3) {
      let v = value as Vec3
      floats.push(v.x, v.y, v.z)
    } else {
      floats.push(value as number)
    }
  }
  return floats
}

export const shapeFromFloats = (type: ShapeType, floats: readonly number[]): OperationShape => {
  let shape: Record<string, unknown> = { type }
  let at = 0
  for (let parameter of PRIMITIVES[type].parameters) {
    if (parameter.arity === 3) {
      shape[parameter.name] = { x: floats[at], y: floats[at + 1], z: floats[at + 2] }
      at += 3
    } else {
      shape[parameter.name] = floats[at]
      at += 1
    }
  }
  return shape as unknown as OperationShape
}

/** One number field of a dimension group: an axis of a vector, or a scalar. */
export interface DimensionField {
  readonly name: string
  readonly axis: "x" | "y" | "z" | undefined
  readonly label: string
  readonly value: number
  readonly min: number
  readonly step: number
}

/** One parameter as the panel lays it out: a labelled group of fields. */
export interface DimensionGroup {
  readonly name: string
  readonly label: string
  readonly fields: readonly DimensionField[]
}

const AXES = ["x", "y", "z"] as const

export const dimensionGroups = (shape: OperationShape): readonly DimensionGroup[] => {
  let values = shape as unknown as Record<string, unknown>
  return PRIMITIVES[shape.type].parameters.map(parameter => ({
    name: parameter.name,
    label: parameter.label,
    fields:
      parameter.arity === 3
        ? AXES.map((axis, index) => ({
            name: parameter.name,
            axis,
            label: (parameter.axes ?? AXES)[index]!,
            value: (values[parameter.name] as Vec3)[axis],
            min: parameter.min,
            step: parameter.step,
          }))
        : [{ name: parameter.name, axis: undefined, label: parameter.label, value: values[parameter.name] as number, min: parameter.min, step: parameter.step }],
  }))
}

/** The shape with one parameter (or one axis of one) replaced. */
export const withParameter = (shape: OperationShape, name: string, axis: "x" | "y" | "z" | undefined, value: number): OperationShape => {
  let values = shape as unknown as Record<string, unknown>
  if (values[name] === undefined) return shape
  if (axis === undefined) return { ...values, [name]: value } as unknown as OperationShape
  return { ...values, [name]: { ...(values[name] as Vec3), [axis]: value } } as unknown as OperationShape
}

/** The shape a freshly added primitive starts as. */
export const defaultShape = (type: ShapeType): OperationShape => {
  switch (type) {
    case "Sphere":
      return { type, radius: 0.5 }
    case "Ellipsoid":
      return { type, radius: { x: 0.7, y: 0.5, z: 0.4 } }
    case "Box":
      return { type, len: { x: 0.6, y: 0.6, z: 0.6 } }
    case "RoundBox":
      return { type, len: { x: 0.5, y: 0.5, z: 0.5 }, radius: 0.15 }
    case "Capsule":
      return { type, len: 1.2, radius: 0.35 }
    case "Cone":
      return { type, len: 1, radius: 0.5 }
    case "Cylinder":
      return { type, len: 1, radius: 0.4 }
    case "Torus":
      return { type, majorRadius: 0.6, minorRadius: 0.2 }
    case "HexPrism":
      return { type, len: 1, radius: 0.5 }
  }
}

/** Whether rotating the shape changes it enough to offer the rotation fields. */
export const isAxial = (type: ShapeType): boolean => type !== "Sphere" && type !== "Ellipsoid" && type !== "RoundBox"

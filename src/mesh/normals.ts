// Vertex normals: the area-weighted sum of the faces around each vertex,
// falling back to the field's gradient where the faces cancel out.

import type { Field } from "../model/field"
import type { MeshData } from "./builder"

export const fillNormals = (mesh: MeshData, field: Field, step: number): void => {
  let { positions, indices, normals } = mesh
  normals.fill(0)
  for (let t = 0; t < mesh.triangleCount; t++) {
    let a = indices[t * 3]! * 3
    let b = indices[t * 3 + 1]! * 3
    let c = indices[t * 3 + 2]! * 3
    let ux = positions[b]! - positions[a]!
    let uy = positions[b + 1]! - positions[a + 1]!
    let uz = positions[b + 2]! - positions[a + 2]!
    let vx = positions[c]! - positions[a]!
    let vy = positions[c + 1]! - positions[a + 1]!
    let vz = positions[c + 2]! - positions[a + 2]!
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    normals[a] = normals[a]! + nx
    normals[a + 1] = normals[a + 1]! + ny
    normals[a + 2] = normals[a + 2]! + nz
    normals[b] = normals[b]! + nx
    normals[b + 1] = normals[b + 1]! + ny
    normals[b + 2] = normals[b + 2]! + nz
    normals[c] = normals[c]! + nx
    normals[c + 1] = normals[c + 1]! + ny
    normals[c + 2] = normals[c + 2]! + nz
  }
  let gradient = { x: 0, y: 1, z: 0 }
  for (let v = 0; v < mesh.vertexCount * 3; v += 3) {
    let x = normals[v]!
    let y = normals[v + 1]!
    let z = normals[v + 2]!
    let length = Math.sqrt(x * x + y * y + z * z)
    if (length > 0) {
      normals[v] = x / length
      normals[v + 1] = y / length
      normals[v + 2] = z / length
      continue
    }
    if (!field.gradient(positions[v]!, positions[v + 1]!, positions[v + 2]!, step, gradient)) {
      gradient.x = 0
      gradient.y = 1
      gradient.z = 0
    }
    normals[v] = gradient.x
    normals[v + 1] = gradient.y
    normals[v + 2] = gradient.z
  }
}

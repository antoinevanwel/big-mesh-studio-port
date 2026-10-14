// The model's look once it has paint: the same Blinn-Phong as the unpainted
// model, with the paint field sampled by world position in a `surface`
// function before the lighting, so a stroke is lit like the surface under
// it. Ported from big-mesh-studios' sdf-modeller view/model-material.ts
// (its field path; the atlas path upstream also keeps is dead there).
//
// The field is two 3D textures: the indirection grid, read at the brick's
// cell centre, says which slot of the pool holds the brick, and the pool is
// sampled there with hardware trilinear filtering; the 1.5 is the gutter
// (cell n of a slot holds voxel n - 1). The bytes are premultiplied (the
// rasteriser writes colour × alpha), so they are divided by the coverage
// before the sRGB decode. Upstream's blend between replacing and tinting
// is kept as written: 0, the only value its controls can set, replaces.

import { createTexture3D, uploadTexture, type TextureId } from "@solidrt/core/gpu"
import { shaderMaterialClass, type Material } from "@solidrt/3d"
import { litVertex, phongFragment } from "@solidrt/3d/glsl"
import { BRICK, GRID_RES, SLOT, type PaintField } from "../paint/field"

/** Upstream's sRGB decode for the stroke colour. */
const SRGB_GAMMA = 2.2
/** The smallest linear value raised to the gamma, so black never becomes a NaN. */
const MIN_LINEAR = 1e-5

const PRELUDE = `
  uniform sampler3D uPaintPool;
  uniform sampler3D uPaintGrid;
  uniform vec3 uPaintOrigin;
  uniform vec3 uPaintExtent;
  uniform vec3 uPaintBricks;
  uniform float uPaintPoolDim;
  uniform float uPaintBlend;

  vec4 samplePaint(vec3 world) {
    vec3 uvw = (world - uPaintOrigin) / uPaintExtent;
    float low = min(min(uvw.x, uvw.y), uvw.z);
    float high = max(max(uvw.x, uvw.y), uvw.z);
    if (min(low, 1.0 - high) <= 0.0) return vec4(0.0);
    vec3 cells = uvw * uPaintBricks;
    vec3 brick = floor(cells);
    vec4 info = texture(uPaintGrid, (brick + 0.5) / ${GRID_RES.toFixed(1)});
    if (info.a < 0.5) return vec4(0.0);
    vec3 slot = info.xyz * 255.0 * ${SLOT.toFixed(1)} + 1.5 + (cells - brick) * ${BRICK.toFixed(1)};
    return texture(uPaintPool, slot / uPaintPoolDim);
  }
`

const SURFACE = `
  void surface(inout Surface s) {
    vec4 paint = samplePaint(vWorldPos);
    float coverage = paint.a;
    vec3 straight = paint.rgb / max(coverage, 1.0 / 255.0);
    vec3 stroke = pow(max(straight, vec3(${MIN_LINEAR})), vec3(${SRGB_GAMMA.toFixed(1)}));
    // The base is premultiplied, so the stroke takes its alpha.
    vec3 replacing = s.base.rgb * (1.0 - coverage) + stroke * s.base.a * coverage;
    vec3 tinting = s.base.rgb * ((1.0 - coverage) + coverage * stroke);
    s.base.rgb = mix(replacing, tinting, uPaintBlend);
  }
`

// The unpainted model's options (viewport.tsx), as one class each for the
// opaque and the translucent model.
const lit = (transparent: boolean) => {
  let options = { vertexColors: true, cull: "none" as const, transparent, prelude: PRELUDE, surface: SURFACE }
  return shaderMaterialClass({ vertex: litVertex(options), fragment: phongFragment(options), transparent, cull: "none", label: transparent ? "painted-glass" : "painted" })
}
let classes: { solid: ReturnType<typeof lit>; glassy: ReturnType<typeof lit> } | undefined

export interface PaintedLook {
  readonly solid: Material
  readonly glassy: Material
  /** Sends the field to the GPU when it changed since the last call. */
  readonly sync: () => void
}

/** The field's two textures and the materials sampling them; freed with the calling owner. */
export const createPaintedLook = (field: PaintField, blend: number): PaintedLook => {
  classes ??= { solid: lit(false), glassy: lit(true) }
  let pool: TextureId = createTexture3D(field.pool, field.poolDim, field.poolDim, field.poolDim, { filter: "linear", wrap: "clamp", label: "paint-pool" })
  let grid: TextureId = createTexture3D(field.indirection, GRID_RES, GRID_RES, GRID_RES, { filter: "linear", wrap: "clamp", label: "paint-grid" })
  field.markSynced()
  let bricks = field.bricksPerAxis
  let params = {
    uColor: [1, 1, 1, 1],
    uSpecular: 0.12,
    uShininess: 24,
    uPaintOrigin: [...field.origin],
    uPaintExtent: [...field.extent],
    uPaintBricks: [...bricks],
    uPaintPoolDim: field.poolDim,
    uPaintBlend: blend,
  }
  let textures = { uPaintPool: pool, uPaintGrid: grid }
  return {
    solid: classes.solid.instance({ params, textures }),
    glassy: classes.glassy.instance({ params, textures }),
    // The whole volume, as upstream re-sends its textures on every change.
    sync: () => {
      if (!field.dirtySinceSync) return
      uploadTexture(pool, field.pool)
      uploadTexture(grid, field.indirection)
      field.markSynced()
    },
  }
}

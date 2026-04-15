import { init, potrace } from 'esm-potrace-wasm'

let initPromise: Promise<unknown> | null = null

/** Load the Potrace WASM once; concurrent callers share the same promise. */
export function ensureInit(): Promise<unknown> {
  if (initPromise === null) initPromise = init()
  return initPromise
}

export interface TraceOptions {
  turdsize?: number
  turnpolicy?: number
  alphamax?: number
  opticurve?: number
  opttolerance?: number
  pathonly?: boolean
  extractcolors?: boolean
  posterizelevel?: number // [1, 255]
  posterizationalgorithm?: number // 0: simple, 1: interpolation
}

export const DEFAULT_OPTIONS: Required<TraceOptions> = {
  turdsize: 2,
  turnpolicy: 4,
  alphamax: 1,
  opticurve: 1,
  opttolerance: 0.2,
  pathonly: false,
  extractcolors: true,
  posterizelevel: 2,
  posterizationalgorithm: 0
}

/** Trace a raster image (PNG/JPG bytes via Blob) into an SVG string. */
export async function trace(
  bytes: Uint8Array,
  options: TraceOptions = {}
): Promise<string> {
  await ensureInit()
  // Cast: modern lib.dom types Uint8Array as Uint8Array<ArrayBufferLike> which
  // isn't assignable to BlobPart, but the runtime accepts it fine.
  const blob = new Blob([bytes as BlobPart])
  const bitmap = await createImageBitmap(blob)
  const merged = { ...DEFAULT_OPTIONS, ...options }
  // Potrace's `pathonly + extractcolors` combo returns a mangled mix of <g>
  // tags and raw M-commands fragmented by `split("M")`, producing invalid
  // output. Force monochrome when pathonly is requested.
  if (merged.pathonly) merged.extractcolors = false

  // esm-potrace-wasm's type says `Promise<string>`, but with `pathonly: true`
  // it returns `string[]` — an array of M-prefixed path-data strings.
  const raw = (await potrace(bitmap, merged)) as unknown as string | string[]

  if (Array.isArray(raw)) {
    const w = bitmap.width
    const h = bitmap.height
    const paths = raw.map((d) => `<path d="${d}" fill="#000"/>`).join('')
    // Potrace emits coordinates in its internal system (10× scale, Y-flipped
    // PostScript convention). Match the same transform the `extractcolors`
    // branch applies — otherwise the geometry sits outside the viewBox.
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ` +
      `width="${w}" height="${h}">` +
      `<g transform="translate(0,${h}) scale(0.1,-0.1)">${paths}</g>` +
      `</svg>`
    )
  }

  return raw
}

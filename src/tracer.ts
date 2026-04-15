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
  const svg = await potrace(bitmap, { ...DEFAULT_OPTIONS, ...options })
  return svg
}

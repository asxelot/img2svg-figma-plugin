import { emit, on, showUI, type EventHandler } from '@create-figma-plugin/utilities'

// Payloads exchanged with the UI
interface SelectionInfoHandler extends EventHandler {
  name: 'SELECTION_INFO'
  handler: (info: { count: number }) => void
}
interface PreviewSourceHandler extends EventHandler {
  name: 'PREVIEW_SOURCE'
  handler: (src: { id: string; bytes: Uint8Array }) => void
}
interface StartHandler extends EventHandler {
  name: 'START'
  handler: () => void
}
interface CancelHandler extends EventHandler {
  name: 'CANCEL'
  handler: () => void
}
interface TraceRequestHandler extends EventHandler {
  name: 'TRACE_REQUEST'
  handler: (req: {
    id: string
    bytes: Uint8Array
    width: number
    height: number
  }) => void
}
interface TraceResultHandler extends EventHandler {
  name: 'TRACE_RESULT'
  handler: (res: { id: string; svg: string }) => void
}
interface TraceErrorHandler extends EventHandler {
  name: 'TRACE_ERROR'
  handler: (err: { id: string; message: string }) => void
}

/**
 * Find the first IMAGE paint on a node, or null if none.
 * Guards against `figma.mixed` fills and nodes that have no `fills` at all.
 */
function firstImagePaint(node: SceneNode): ImagePaint | null {
  if (!('fills' in node)) return null
  const fills = node.fills
  if (fills === figma.mixed) return null
  for (const paint of fills) {
    if (paint.type === 'IMAGE' && paint.imageHash !== null) {
      return paint
    }
  }
  return null
}

export default function () {
  showUI({ width: 380, height: 740 })

  const selection = figma.currentPage.selection
  const jobs: Array<{ node: SceneNode; paint: ImagePaint }> = []
  for (const node of selection) {
    const paint = firstImagePaint(node)
    if (paint !== null) jobs.push({ node, paint })
  }

  if (jobs.length === 0) {
    figma.notify('Select at least one image layer')
    figma.closePlugin()
    return
  }

  // Tell the UI how many traceable images are in the selection, then stream
  // the first image's bytes so the UI can render a live preview.
  emit<SelectionInfoHandler>('SELECTION_INFO', { count: jobs.length })
  ;(async () => {
    const first = jobs[0]
    const image = figma.getImageByHash(first.paint.imageHash as string)
    if (image === null) return
    const bytes = await image.getBytesAsync()
    emit<PreviewSourceHandler>('PREVIEW_SOURCE', { id: first.node.id, bytes })
  })()

  // Track originals so we can swap them when the UI replies.
  const pending = new Map<string, SceneNode>()
  let completed = 0

  on<TraceResultHandler>('TRACE_RESULT', ({ id, svg }) => {
    const original = pending.get(id)
    pending.delete(id)
    if (original === undefined || original.removed) return

    const frame = figma.createNodeFromSvg(svg)
    frame.x = original.x
    frame.y = original.y
    frame.resize(original.width, original.height)
    frame.name = `${original.name} (vector)`

    const parent = original.parent ?? figma.currentPage
    const index = parent.children.indexOf(original)
    parent.appendChild(frame)
    if (index !== -1) parent.insertChild(index, frame)

    original.remove()

    completed += 1
    if (pending.size === 0) {
      figma.notify(`Traced ${completed} image${completed === 1 ? '' : 's'}`)
      figma.closePlugin()
    }
  })

  on<TraceErrorHandler>('TRACE_ERROR', ({ id, message }) => {
    pending.delete(id)
    figma.notify(`Trace failed: ${message}`, { error: true })
    if (pending.size === 0) figma.closePlugin()
  })

  on<CancelHandler>('CANCEL', () => {
    figma.closePlugin()
  })

  // Start tracing only once the UI tells us the user has confirmed options.
  on<StartHandler>('START', async () => {
    for (const { node, paint } of jobs) {
      const image = figma.getImageByHash(paint.imageHash as string)
      if (image === null) continue
      const bytes = await image.getBytesAsync()

      pending.set(node.id, node)
      emit<TraceRequestHandler>('TRACE_REQUEST', {
        id: node.id,
        bytes,
        width: node.width,
        height: node.height
      })
    }

    if (pending.size === 0) {
      figma.notify('No image bytes found')
      figma.closePlugin()
    }
  })
}

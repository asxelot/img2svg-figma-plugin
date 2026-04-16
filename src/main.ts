import { emit, on, showUI, type EventHandler } from '@create-figma-plugin/utilities'

// ---- Message types ---------------------------------------------------------

interface UiReadyHandler extends EventHandler {
  name: 'UI_READY'
  handler: () => void
}
interface JobsHandler extends EventHandler {
  name: 'JOBS'
  handler: (msg: { jobs: Array<{ id: string; bytes: Uint8Array }> }) => void
}
interface TraceResultHandler extends EventHandler {
  name: 'TRACE_RESULT'
  handler: (res: { id: string; svg: string }) => void
}
interface TraceErrorHandler extends EventHandler {
  name: 'TRACE_ERROR'
  handler: (err: { id: string; message: string }) => void
}
interface ApplyHandler extends EventHandler {
  name: 'APPLY'
  handler: () => void
}
interface CancelHandler extends EventHandler {
  name: 'CANCEL'
  handler: () => void
}

// ---- Selection helpers -----------------------------------------------------

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

// ---- Entry point -----------------------------------------------------------

interface LiveState {
  original: SceneNode
  generated: SceneNode | null
  originalVisible: boolean // pre-hide visibility so we can restore it on cancel
}

export default function () {
  showUI({ width: 420, height: 960 })

  const selection = figma.currentPage.selection
  const originals: Array<{ node: SceneNode; paint: ImagePaint }> = []
  for (const node of selection) {
    const paint = firstImagePaint(node)
    if (paint !== null) originals.push({ node, paint })
  }

  if (originals.length === 0) {
    figma.notify('Select at least one image layer')
    figma.closePlugin()
    return
  }

  const states = new Map<string, LiveState>()
  for (const { node } of originals) {
    states.set(node.id, {
      original: node,
      generated: null,
      originalVisible: node.visible
    })
  }

  // Wait for the UI to signal it has registered its handlers before we emit
  // JOBS — otherwise the UI's `on('JOBS', …)` may not exist yet and
  // create-figma-plugin throws "No event handler with name `JOBS`".
  on<UiReadyHandler>('UI_READY', async () => {
    const jobs: Array<{ id: string; bytes: Uint8Array }> = []
    for (const { node, paint } of originals) {
      const image = figma.getImageByHash(paint.imageHash as string)
      if (image === null) continue
      const bytes = await image.getBytesAsync()
      jobs.push({ id: node.id, bytes })
    }
    emit<JobsHandler>('JOBS', { jobs })
  })

  // A fresh trace result comes in → swap the generated frame in place.
  on<TraceResultHandler>('TRACE_RESULT', ({ id, svg }) => {
    const state = states.get(id)
    if (state === undefined || state.original.removed) return

    // Reject output that isn't a full <svg> document — Figma rejects it and
    // throws, which would otherwise hang the plugin.
    if (!svg.includes('<svg')) {
      figma.notify('Tracer returned malformed SVG', { error: true })
      return
    }

    let frame: FrameNode
    try {
      frame = figma.createNodeFromSvg(svg)
    } catch (err) {
      figma.notify(`Figma rejected traced SVG: ${String(err)}`, { error: true })
      return
    }

    // Build the replacement frame from the traced SVG.
    frame.x = state.original.x
    frame.y = state.original.y
    frame.resize(state.original.width, state.original.height)
    frame.name = `${state.original.name} (vector)`

    const parent = state.original.parent ?? figma.currentPage
    parent.appendChild(frame)
    const index = parent.children.indexOf(state.original)
    if (index !== -1) parent.insertChild(index, frame)

    // First trace for this node: hide the original so only the vector is visible.
    if (state.generated === null && state.original.visible) {
      state.original.visible = false
    }

    // Remove the previous generated frame (if any) only after the new one is in
    // place, so the Figma viewport never shows a gap.
    if (state.generated !== null && !state.generated.removed) {
      state.generated.remove()
    }
    state.generated = frame
  })

  on<TraceErrorHandler>('TRACE_ERROR', ({ message }) => {
    figma.notify(`Trace failed: ${message}`, { error: true })
  })

  // Track why the plugin is closing so the `close` handler doesn't undo work
  // that Apply/Cancel already committed.
  let intent: 'apply' | 'cancel' | null = null

  // Apply: commit everything by permanently removing the hidden originals.
  on<ApplyHandler>('APPLY', () => {
    intent = 'apply'
    let committed = 0
    for (const state of states.values()) {
      if (state.generated !== null && !state.original.removed) {
        state.original.remove()
        committed += 1
      }
    }
    if (committed === 0) {
      figma.notify('No images were traced')
    } else {
      figma.notify(`Traced ${committed} image${committed === 1 ? '' : 's'}`)
    }
    figma.closePlugin()
  })

  // Cancel: revert every live change — remove generated frames, restore originals.
  on<CancelHandler>('CANCEL', () => {
    intent = 'cancel'
    for (const state of states.values()) {
      if (state.generated !== null && !state.generated.removed) {
        state.generated.remove()
      }
      state.generated = null
      if (!state.original.removed) {
        state.original.visible = state.originalVisible
      }
    }
    figma.closePlugin()
  })

  // X button in the plugin window chrome → no explicit choice was made.
  // Default to Cancel so the user's original images are restored.
  figma.on('close', () => {
    if (intent !== null) return
    for (const state of states.values()) {
      if (state.generated !== null && !state.generated.removed) {
        state.generated.remove()
      }
      if (!state.original.removed) {
        state.original.visible = state.originalVisible
      }
    }
  })
}

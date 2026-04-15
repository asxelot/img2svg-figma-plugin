import {
  Button,
  Checkbox,
  Container,
  Divider,
  Dropdown,
  type DropdownOption,
  RangeSlider,
  SegmentedControl,
  type SegmentedControlOption,
  Text,
  VerticalSpace,
  render
} from '@create-figma-plugin/ui'
import { emit, on, type EventHandler } from '@create-figma-plugin/utilities'
import { Fragment, h } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import { DEFAULT_OPTIONS, ensureInit, trace, type TraceOptions } from './tracer'

interface SelectionInfoHandler extends EventHandler {
  name: 'SELECTION_INFO'
  handler: (info: { count: number }) => void
}
interface PreviewSourceHandler extends EventHandler {
  name: 'PREVIEW_SOURCE'
  handler: (src: { id: string; bytes: Uint8Array }) => void
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

type Stage =
  | { kind: 'loading' }
  | { kind: 'ready'; count: number }
  | { kind: 'working'; done: number; total: number }
  | { kind: 'error'; message: string }

type Preview =
  | { kind: 'empty' }
  | { kind: 'tracing'; svg: string | null }
  | { kind: 'ready'; svg: string }
  | { kind: 'error'; message: string }

const PREVIEW_DEBOUNCE_MS = 200

const TURN_POLICIES: DropdownOption[] = [
  { value: '0', text: 'Black' },
  { value: '1', text: 'White' },
  { value: '2', text: 'Left' },
  { value: '3', text: 'Right' },
  { value: '4', text: 'Minority' },
  { value: '5', text: 'Majority' },
  { value: '6', text: 'Random' }
]

const POSTERIZATION_ALGORITHMS: SegmentedControlOption[] = [
  { value: '0', children: 'Simple' },
  { value: '1', children: 'Interpolation' }
]

function Plugin() {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' })
  const [opts, setOpts] = useState<Required<TraceOptions>>(DEFAULT_OPTIONS)
  const [preview, setPreview] = useState<Preview>({ kind: 'empty' })
  const [source, setSource] = useState<Uint8Array | null>(null)

  // Latest options for use inside stale closures.
  const optsRef = useRef(opts)
  optsRef.current = opts

  // Serialize previews: each change bumps the generation; late results are dropped.
  const genRef = useRef(0)

  // Register message handlers once.
  useEffect(() => {
    ensureInit().catch((err) =>
      setStage({ kind: 'error', message: `WASM init failed: ${String(err)}` })
    )

    const offSel = on<SelectionInfoHandler>('SELECTION_INFO', ({ count }) => {
      setStage((s) => (s.kind === 'loading' ? { kind: 'ready', count } : s))
    })

    const offSrc = on<PreviewSourceHandler>('PREVIEW_SOURCE', ({ bytes }) => {
      setSource(bytes)
    })

    let total = 0
    let done = 0
    const offReq = on<TraceRequestHandler>(
      'TRACE_REQUEST',
      async ({ id, bytes }) => {
        total += 1
        setStage({ kind: 'working', done, total })
        try {
          const svg = await trace(bytes, optsRef.current)
          emit('TRACE_RESULT', { id, svg })
        } catch (err) {
          emit('TRACE_ERROR', { id, message: String(err) })
        } finally {
          done += 1
          setStage({ kind: 'working', done, total })
        }
      }
    )

    return () => {
      offSel()
      offSrc()
      offReq()
    }
  }, [])

  // Re-trace the preview whenever source or options change (debounced).
  useEffect(() => {
    if (source === null) return
    const gen = ++genRef.current
    setPreview((p) => ({
      kind: 'tracing',
      svg: p.kind === 'ready' ? p.svg : p.kind === 'tracing' ? p.svg : null
    }))

    const timer = setTimeout(async () => {
      try {
        const svg = await trace(source, opts)
        if (gen === genRef.current) setPreview({ kind: 'ready', svg })
      } catch (err) {
        if (gen === genRef.current) {
          setPreview({ kind: 'error', message: String(err) })
        }
      }
    }, PREVIEW_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [source, opts])

  function set<K extends keyof TraceOptions>(
    key: K,
    value: Required<TraceOptions>[K]
  ) {
    setOpts((prev) => ({ ...prev, [key]: value }))
  }

  const working = stage.kind === 'working'
  const disabled = working

  return (
    <Container space="medium">
      <VerticalSpace space="medium" />
      <PreviewPane preview={preview} />
      <VerticalSpace space="small" />
      <Text>
        <strong>{renderStatus(stage)}</strong>
      </Text>
      <VerticalSpace space="medium" />
      <Divider />
      <VerticalSpace space="medium" />

      <NumericSlider
        label="turdsize"
        value={opts.turdsize}
        min={0}
        max={100}
        step={1}
        disabled={disabled}
        onChange={(v) => set('turdsize', v)}
      />

      <EnumRow label="turnpolicy">
        <Dropdown
          options={TURN_POLICIES}
          value={String(opts.turnpolicy)}
          disabled={disabled}
          onValueChange={(v) => set('turnpolicy', Number(v))}
        />
      </EnumRow>

      <NumericSlider
        label="alphamax"
        value={opts.alphamax}
        min={0}
        max={1.334}
        step={0.01}
        precision={3}
        disabled={disabled}
        onChange={(v) => set('alphamax', v)}
      />

      <BoolRow
        label="opticurve"
        value={opts.opticurve === 1}
        disabled={disabled}
        onChange={(v) => set('opticurve', v ? 1 : 0)}
      />

      <NumericSlider
        label="opttolerance"
        value={opts.opttolerance}
        min={0}
        max={1}
        step={0.01}
        precision={2}
        disabled={disabled}
        onChange={(v) => set('opttolerance', v)}
      />

      <BoolRow
        label="pathonly"
        value={opts.pathonly}
        disabled={disabled}
        onChange={(v) => set('pathonly', v)}
      />

      <BoolRow
        label="extractcolors"
        value={opts.extractcolors}
        disabled={disabled}
        onChange={(v) => set('extractcolors', v)}
      />

      <NumericSlider
        label="posterizelevel"
        value={opts.posterizelevel}
        min={1}
        max={32}
        step={1}
        disabled={disabled}
        onChange={(v) => set('posterizelevel', v)}
      />

      <EnumRow label="posterizationalgorithm">
        <SegmentedControl
          options={POSTERIZATION_ALGORITHMS}
          value={String(opts.posterizationalgorithm)}
          disabled={disabled}
          onValueChange={(v) => set('posterizationalgorithm', Number(v))}
        />
      </EnumRow>

      <VerticalSpace space="medium" />
      <Divider />
      <VerticalSpace space="medium" />

      <Button
        fullWidth
        disabled={stage.kind !== 'ready' || stage.count === 0}
        loading={working}
        onClick={() => emit('START')}
      >
        {stage.kind === 'ready'
          ? `Trace ${stage.count} image${stage.count === 1 ? '' : 's'}`
          : 'Trace'}
      </Button>
      <VerticalSpace space="small" />
      <Button fullWidth secondary onClick={() => emit('CANCEL')}>
        Cancel
      </Button>
      <VerticalSpace space="medium" />
    </Container>
  )
}

function PreviewPane({ preview }: { preview: Preview }) {
  const svg =
    preview.kind === 'ready'
      ? preview.svg
      : preview.kind === 'tracing'
        ? preview.svg
        : null

  const src =
    svg === null ? null : `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

  const wrapperStyle = {
    position: 'relative' as const,
    width: '100%',
    height: '180px',
    background:
      'repeating-conic-gradient(rgba(0,0,0,0.06) 0% 25%, transparent 0% 50%) 50% / 16px 16px',
    borderRadius: '4px',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }

  const overlayStyle = {
    position: 'absolute' as const,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255,255,255,0.4)',
    fontSize: '11px',
    opacity: preview.kind === 'tracing' ? 1 : 0,
    transition: 'opacity 120ms ease',
    pointerEvents: 'none' as const
  }

  return (
    <div style={wrapperStyle}>
      {src !== null && (
        <img
          src={src}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain'
          }}
        />
      )}
      {svg === null && preview.kind !== 'error' && (
        <Text>
          <span style={{ opacity: 0.6 }}>Preview loading…</span>
        </Text>
      )}
      {preview.kind === 'error' && (
        <Text>
          <span style={{ color: 'crimson' }}>Trace error: {preview.message}</span>
        </Text>
      )}
      <div style={overlayStyle}>Tracing…</div>
    </div>
  )
}

function renderStatus(s: Stage): string {
  switch (s.kind) {
    case 'loading':
      return 'Loading tracer…'
    case 'ready':
      return s.count === 1 ? '1 image selected' : `${s.count} images selected`
    case 'working':
      return `Tracing ${s.done}/${s.total}…`
    case 'error':
      return s.message
  }
}

function NumericSlider(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  precision?: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  const display =
    props.precision === undefined
      ? String(props.value)
      : props.value.toFixed(props.precision)
  return (
    <Fragment>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Text>{props.label}</Text>
        <Text>
          <span style={{ opacity: 0.6 }}>{display}</span>
        </Text>
      </div>
      <VerticalSpace space="extraSmall" />
      <RangeSlider
        minimum={props.min}
        maximum={props.max}
        increment={props.step}
        value={String(props.value)}
        disabled={props.disabled}
        onNumericValueInput={(v) => props.onChange(v)}
      />
      <VerticalSpace space="small" />
    </Fragment>
  )
}

function BoolRow(props: {
  label: string
  value: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Fragment>
      <Checkbox
        value={props.value}
        disabled={props.disabled}
        onValueChange={(v) => props.onChange(v)}
      >
        <Text>{props.label}</Text>
      </Checkbox>
      <VerticalSpace space="small" />
    </Fragment>
  )
}

function EnumRow(props: {
  label: string
  children: preact.ComponentChildren
}) {
  return (
    <Fragment>
      <Text>{props.label}</Text>
      <VerticalSpace space="extraSmall" />
      {props.children}
      <VerticalSpace space="small" />
    </Fragment>
  )
}

export default render(Plugin)

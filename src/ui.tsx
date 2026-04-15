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

interface JobsHandler extends EventHandler {
  name: 'JOBS'
  handler: (msg: { jobs: Array<{ id: string; bytes: Uint8Array }> }) => void
}

interface Job {
  id: string
  bytes: Uint8Array
}

type Stage =
  | { kind: 'loading' }
  | { kind: 'ready'; count: number }
  | { kind: 'error'; message: string }

type Preview =
  | { kind: 'empty' }
  | { kind: 'tracing'; svg: string | null }
  | { kind: 'ready'; svg: string }
  | { kind: 'error'; message: string }

/** Preserve the last good SVG while re-tracing so the preview doesn't flicker. */
function asTracing(p: Preview): Preview {
  if (p.kind === 'ready') return { kind: 'tracing', svg: p.svg }
  if (p.kind === 'tracing') return p
  return { kind: 'tracing', svg: null }
}

const PREVIEW_HEIGHT_PX = 180

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
  const [jobs, setJobs] = useState<Job[]>([])

  // Run-latest loop state. Each options/jobs change bumps `dirtyRef` and either
  // starts a trace batch or lets the in-flight one pick up the newest values.
  const runningRef = useRef(false)
  const dirtyRef = useRef(false)
  const latestRef = useRef<{ jobs: Job[]; opts: Required<TraceOptions> }>({
    jobs: [],
    opts
  })

  useEffect(() => {
    ensureInit().catch((err) =>
      setStage({ kind: 'error', message: `WASM init failed: ${String(err)}` })
    )

    const offJobs = on<JobsHandler>('JOBS', ({ jobs }) => {
      setJobs(jobs)
      setStage({ kind: 'ready', count: jobs.length })
    })

    return () => offJobs()
  }, [])

  useEffect(() => {
    latestRef.current = { jobs, opts }
    if (jobs.length === 0) return
    dirtyRef.current = true
    if (runningRef.current) return

    runningRef.current = true
    setPreview((p) => asTracing(p))
    ;(async () => {
      try {
        while (dirtyRef.current) {
          dirtyRef.current = false
          const { jobs: js, opts: o } = latestRef.current
          if (js.length === 0) return

          let previewSvg: string | null = null
          for (let i = 0; i < js.length; i += 1) {
            const job = js[i]
            try {
              const svg = await trace(job.bytes, o)
              emit('TRACE_RESULT', { id: job.id, svg })
              if (i === 0) previewSvg = svg
            } catch (err) {
              emit('TRACE_ERROR', { id: job.id, message: String(err) })
              if (i === 0) {
                setPreview({ kind: 'error', message: String(err) })
                previewSvg = null
              }
            }
            // Bail out of the inner loop if options changed mid-batch — the
            // outer loop will restart with the freshest options.
            if (dirtyRef.current) break
          }

          if (previewSvg !== null) {
            if (!dirtyRef.current) {
              setPreview({ kind: 'ready', svg: previewSvg })
            } else {
              setPreview((p) => asTracing(p))
            }
          }
        }
      } finally {
        runningRef.current = false
      }
    })()
  }, [jobs, opts])

  function set<K extends keyof TraceOptions>(
    key: K,
    value: Required<TraceOptions>[K]
  ) {
    setOpts((prev) => ({ ...prev, [key]: value }))
  }

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
        onChange={(v) => set('turdsize', v)}
      />

      <EnumRow label="turnpolicy">
        <Dropdown
          options={TURN_POLICIES}
          value={String(opts.turnpolicy)}
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
        onChange={(v) => set('alphamax', v)}
      />

      <BoolRow
        label="opticurve"
        value={opts.opticurve === 1}
        onChange={(v) => set('opticurve', v ? 1 : 0)}
      />

      <NumericSlider
        label="opttolerance"
        value={opts.opttolerance}
        min={0}
        max={1}
        step={0.01}
        precision={2}
        onChange={(v) => set('opttolerance', v)}
      />

      <BoolRow
        label="pathonly"
        value={opts.pathonly}
        onChange={(v) => set('pathonly', v)}
      />

      <BoolRow
        label={
          opts.pathonly
            ? 'extractcolors (forced off by pathonly)'
            : 'extractcolors'
        }
        value={opts.pathonly ? false : opts.extractcolors}
        disabled={opts.pathonly}
        onChange={(v) => set('extractcolors', v)}
      />

      <NumericSlider
        label="posterizelevel"
        value={opts.posterizelevel}
        min={1}
        max={32}
        step={1}
        onChange={(v) => set('posterizelevel', v)}
      />

      <EnumRow label="posterizationalgorithm">
        <SegmentedControl
          options={POSTERIZATION_ALGORITHMS}
          value={String(opts.posterizationalgorithm)}
          onValueChange={(v) => set('posterizationalgorithm', Number(v))}
        />
      </EnumRow>

      <VerticalSpace space="medium" />
      <Divider />
      <VerticalSpace space="medium" />

      <Button
        fullWidth
        disabled={stage.kind !== 'ready' || stage.count === 0}
        onClick={() => emit('APPLY')}
      >
        {stage.kind === 'ready'
          ? `Apply to ${stage.count} image${stage.count === 1 ? '' : 's'}`
          : 'Apply'}
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
    height: `${PREVIEW_HEIGHT_PX}px`,
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

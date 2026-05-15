import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getTemplate, patchTemplatePositions, triggerWorkflow } from '../api/client'
import type { WorkflowTemplate, NodePosition } from '@legion/core'
import TemplateCanvas from '../components/TemplateCanvas'

export default function TemplateDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [template, setTemplate] = useState<WorkflowTemplate | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Trigger workflow form state
  const [userPrompt, setUserPrompt] = useState('')
  const [baseRef, setBaseRef] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  // Drag / Save state
  const [dirty, setDirty] = useState(false)
  const [saveSignal, setSaveSignal] = useState(0)
  const [pending, setPending] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const positionsRef = useRef<Record<string, NodePosition>>({})

  useEffect(() => {
    if (!id) return
    getTemplate(id)
      .then(setTemplate)
      .catch((e) => setLoadError((e as Error).message))
  }, [id])

  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  useEffect(() => {
    if (!template) return
    document.title = `${dirty ? '● ' : ''}${template.name} — legion`
    return () => { document.title = 'legion' }
  }, [dirty, template])

  async function handleTrigger(e: FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    setWarning(null)
    if (!userPrompt.trim()) {
      setWarning('User prompt is required.')
      return
    }
    if (!id) return
    setSubmitting(true)
    try {
      const { workflowInstanceId } = await triggerWorkflow(
        id,
        userPrompt,
        baseRef.trim() || undefined,
      )
      navigate(`/instances/${workflowInstanceId}`)
    } catch (err) {
      setSubmitError((err as Error).message)
      setSubmitting(false)
    }
  }

  const onSave = async () => {
    if (!template || pending) return
    setPending(true)
    try {
      const updated = await patchTemplatePositions(template.id, positionsRef.current)
      setTemplate(updated)
      setSaveSignal((n) => n + 1)
      setDirty(false)
      setSaveError(null)
    } catch (e) {
      setSaveError((e as Error).message)
    }
    setPending(false)
  }

  const onReset = () => { setSaveSignal((n) => n + 1); setDirty(false) }

  if (loadError) return <div style={{ padding: 16, color: 'var(--status-error)' }}>Error: {loadError}</div>
  if (!template) return <div style={{ padding: 16 }}>Loading…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          padding: 12,
          borderBottom: '1px solid var(--border-default)',
          background: 'var(--bg-surface)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Link to="/templates">← Templates</Link>
        <strong>{template.name}</strong>
        <span style={{ color: 'var(--fg-muted)' }}>({template.id})</span>
        {dirty && (
          <span
            data-testid="unsaved-badge"
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 4,
              background: 'var(--status-warning, #f59e0b)',
              color: '#fff',
            }}
          >
            Unsaved changes
          </span>
        )}
        {saveError !== null && (
          <span
            data-testid="save-error"
            style={{ fontSize: 12, color: 'var(--status-error)' }}
          >
            Save failed: {saveError}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          data-testid="reset-btn"
          disabled={!dirty || pending}
          onClick={onReset}
        >
          Reset
        </button>
        <button
          data-testid="save-btn"
          disabled={!dirty || pending}
          onClick={onSave}
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>

      <form
        onSubmit={handleTrigger}
        style={{
          padding: 12,
          borderBottom: '1px solid var(--border-default)',
          background: 'var(--bg-surface)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <label htmlFor="trigger-user-prompt" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
          User prompt
        </label>
        <textarea
          id="trigger-user-prompt"
          value={userPrompt}
          onChange={(e) => setUserPrompt(e.target.value)}
          rows={3}
          placeholder="What should the Director do?"
          disabled={submitting}
          style={{
            fontFamily: 'var(--font-base)',
            fontSize: 13,
            padding: 8,
            border: '1px solid var(--border-default)',
            borderRadius: 4,
            background: 'var(--bg-elevated)',
            color: 'var(--fg-primary)',
            resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label htmlFor="trigger-base-ref" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            baseRef
          </label>
          <input
            id="trigger-base-ref"
            type="text"
            value={baseRef}
            onChange={(e) => setBaseRef(e.target.value)}
            placeholder="HEAD"
            disabled={submitting}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              padding: '4px 8px',
              border: '1px solid var(--border-default)',
              borderRadius: 4,
              background: 'var(--bg-elevated)',
              color: 'var(--fg-primary)',
              width: 140,
            }}
          />
          <button
            type="submit"
            disabled={submitting}
            style={{
              marginLeft: 'auto',
              padding: '6px 14px',
              background: 'var(--accent)',
              color: 'var(--accent-fg)',
              border: 'none',
              borderRadius: 4,
              fontSize: 13,
              cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? 'Triggering…' : 'Trigger workflow'}
          </button>
        </div>
        {warning !== null && (
          <div role="alert" style={{ fontSize: 12, color: 'var(--status-warning)' }}>{warning}</div>
        )}
        {submitError !== null && (
          <div role="alert" style={{ fontSize: 12, color: 'var(--status-error)' }}>{submitError}</div>
        )}
      </form>

      <div style={{ flex: 1, minHeight: 0 }}>
        <TemplateCanvas
          template={template}
          onDirtyChange={setDirty}
          onPositionsChange={(p) => { positionsRef.current = p }}
          saveSignal={saveSignal}
        />
      </div>
    </div>
  )
}

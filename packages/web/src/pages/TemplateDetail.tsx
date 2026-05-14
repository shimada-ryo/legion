import { useEffect, useState, type FormEvent } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getTemplate, triggerWorkflow } from '../api/client'
import type { WorkflowTemplate } from '@legion/core'
import TemplateCanvas from '../components/TemplateCanvas'

export default function TemplateDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [template, setTemplate] = useState<WorkflowTemplate | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [userPrompt, setUserPrompt] = useState('')
  const [baseRef, setBaseRef] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    getTemplate(id)
      .then(setTemplate)
      .catch((e) => setLoadError((e as Error).message))
  }, [id])

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

  if (loadError) return <div style={{ padding: 16, color: 'var(--status-error)' }}>Error: {loadError}</div>
  if (!template) return <div style={{ padding: 16 }}>Loading…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border-default)', background: 'var(--bg-surface)' }}>
        <Link to="/templates" style={{ marginRight: 12 }}>← Templates</Link>
        <strong>{template.name}</strong>
        <span style={{ color: 'var(--fg-muted)', marginLeft: 8 }}>({template.id})</span>
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
        <TemplateCanvas template={template} />
      </div>
    </div>
  )
}

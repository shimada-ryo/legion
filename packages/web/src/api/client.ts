import type { InstanceDetail, InstanceSummary, TemplateSummary } from '../types'
import type { WorkflowTemplate } from '@legion/core'

const BASE = '/api' // dev: proxied via Vite; prod: same-origin

export async function listTemplates(): Promise<TemplateSummary[]> {
  const res = await fetch(`${BASE}/templates`)
  if (!res.ok) throw new Error(`GET ${BASE}/templates: ${res.status}`)
  return res.json() as Promise<TemplateSummary[]>
}

export async function getTemplate(id: string): Promise<WorkflowTemplate> {
  const res = await fetch(`${BASE}/templates/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`GET ${BASE}/templates/${id}: ${res.status}`)
  return res.json() as Promise<WorkflowTemplate>
}

export async function listInstances(): Promise<InstanceSummary[]> {
  const res = await fetch(`${BASE}/instances`)
  if (!res.ok) throw new Error(`GET ${BASE}/instances: ${res.status}`)
  return res.json() as Promise<InstanceSummary[]>
}

export async function getInstance(id: string): Promise<InstanceDetail> {
  const res = await fetch(`${BASE}/instances/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`GET ${BASE}/instances/${id}: ${res.status}`)
  return res.json() as Promise<InstanceDetail>
}

export async function triggerWorkflow(
  templateId: string,
  userPrompt: string,
  baseRef?: string,
): Promise<{ workflowInstanceId: string }> {
  const res = await fetch(`${BASE}/workflows/trigger`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ templateId, userPrompt, baseRef }),
  })
  if (!res.ok) throw new Error(`POST ${BASE}/workflows/trigger: ${res.status}`)
  return res.json() as Promise<{ workflowInstanceId: string }>
}

export async function resolveApproval(
  instanceId: string,
  approvalId: string,
  decision: 'approve' | 'deny',
  reason?: string,
): Promise<void> {
  const res = await fetch(
    `${BASE}/instances/${encodeURIComponent(instanceId)}/approvals/${encodeURIComponent(approvalId)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, reason }),
    },
  )
  if (!res.ok) throw new Error(`approval: ${res.status}`)
}

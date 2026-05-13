import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkflowTemplate } from '@legion/core'
import { loadWorkflowTemplate } from './loader'

export class TemplateRegistry {
  private templates = new Map<string, WorkflowTemplate>()

  constructor(private readonly dir: string) {}

  async refresh(): Promise<void> {
    const entries = await readdir(this.dir)
    const next = new Map<string, WorkflowTemplate>()
    for (const e of entries) {
      if (!/\.ya?ml$/i.test(e)) continue
      const t = await loadWorkflowTemplate(join(this.dir, e))
      next.set(t.id, t)
    }
    this.templates = next
  }

  list(): WorkflowTemplate[] {
    return [...this.templates.values()]
  }

  get(id: string): WorkflowTemplate | undefined {
    return this.templates.get(id)
  }
}

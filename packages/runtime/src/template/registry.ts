import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkflowTemplate } from '@legion/core'
import { loadWorkflowTemplate } from './loader'

interface Entry {
  template: WorkflowTemplate
  sourcePath: string
}

export class TemplateRegistry {
  private entries = new Map<string, Entry>()

  constructor(private readonly dir: string) {}

  async refresh(): Promise<void> {
    const files = await readdir(this.dir)
    const next = new Map<string, Entry>()
    for (const name of files) {
      if (!/\.ya?ml$/i.test(name)) continue
      const sourcePath = join(this.dir, name)
      const template = await loadWorkflowTemplate(sourcePath)
      next.set(template.id, { template, sourcePath })
    }
    this.entries = next
  }

  async refreshOne(id: string): Promise<void> {
    const existing = this.entries.get(id)
    if (!existing) throw new Error(`unknown template: ${id}`)
    const template = await loadWorkflowTemplate(existing.sourcePath)
    this.entries.set(id, { template, sourcePath: existing.sourcePath })
  }

  list(): WorkflowTemplate[] {
    return [...this.entries.values()].map((e) => e.template)
  }

  get(id: string): WorkflowTemplate | undefined {
    return this.entries.get(id)?.template
  }

  sourcePathOf(id: string): string | undefined {
    return this.entries.get(id)?.sourcePath
  }
}

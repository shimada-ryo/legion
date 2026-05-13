import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import type {
  WorkflowTemplate,
  TemplateNode,
  TemplateEdge,
  EdgeType,
} from '@legion/core'

const KNOWN_NODE_TYPES = new Set([
  'role',
  'trigger',
  'blackboard',
  'human-gate',
  'sink',
])

const KNOWN_EDGE_TYPES: EdgeType[] = [
  'triggers',
  'delegates',
  'publishes',
  'subscribes',
  'reviews',
  'synthesizes',
]

export async function loadWorkflowTemplate(yamlPath: string): Promise<WorkflowTemplate> {
  const text = await readFile(yamlPath, 'utf-8')
  const parsed = parseYaml(text) as Record<string, unknown> | null
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${yamlPath}: top-level must be an object`)
  }
  if (typeof parsed['id'] !== 'string') throw new Error(`${yamlPath}: missing id`)
  if (typeof parsed['name'] !== 'string') throw new Error(`${yamlPath}: missing name`)
  const nodes = parseNodes(parsed['nodes'], yamlPath)
  const edges = parseEdges(parsed['edges'], yamlPath)
  const out: WorkflowTemplate = {
    id: parsed['id'],
    name: parsed['name'],
    nodes,
    edges,
  }
  if (typeof parsed['description'] === 'string') out.description = parsed['description']
  return out
}

function parseNodes(raw: unknown, file: string): TemplateNode[] {
  if (!Array.isArray(raw)) throw new Error(`${file}: nodes must be an array`)
  return raw.map((n, i) => parseNode(n, file, i))
}

function parseNode(raw: unknown, file: string, idx: number): TemplateNode {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${file}: nodes[${idx}] must be an object`)
  }
  const n = raw as Record<string, unknown>
  if (typeof n['id'] !== 'string' || typeof n['type'] !== 'string') {
    throw new Error(`${file}: nodes[${idx}] missing id or type`)
  }
  if (!KNOWN_NODE_TYPES.has(n['type'])) {
    throw new Error(`${file}: nodes[${idx}] unknown type '${n['type']}'`)
  }
  return n as unknown as TemplateNode
}

function parseEdges(raw: unknown, file: string): TemplateEdge[] {
  if (!Array.isArray(raw)) throw new Error(`${file}: edges must be an array`)
  return raw.map((e, i) => {
    if (typeof e !== 'object' || e === null) {
      throw new Error(`${file}: edges[${i}] must be an object`)
    }
    const ed = e as Record<string, unknown>
    if (
      typeof ed['from'] !== 'string' ||
      typeof ed['to'] !== 'string' ||
      typeof ed['type'] !== 'string'
    ) {
      throw new Error(`${file}: edges[${i}] requires from/to/type`)
    }
    if (!KNOWN_EDGE_TYPES.includes(ed['type'] as EdgeType)) {
      throw new Error(`${file}: edges[${i}] unknown type '${ed['type']}'`)
    }
    return ed as unknown as TemplateEdge
  })
}

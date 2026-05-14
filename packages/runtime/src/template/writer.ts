import { readFile, writeFile } from 'node:fs/promises'
import { parseDocument, isMap, isSeq, type Document } from 'yaml'
import type { NodePosition } from '@legion/core'

export type PositionMap = Record<string, NodePosition>

/**
 * Read sourcePath, update or insert `position` fields for the listed nodes,
 * and write the file back. Comments and key ordering are preserved by
 * round-tripping through yaml's Document API.
 */
export async function writeTemplatePositions(
  sourcePath: string,
  positions: PositionMap,
): Promise<void> {
  const text = await readFile(sourcePath, 'utf-8')
  const doc = parseDocument(text)
  applyPositions(doc, positions)
  await writeFile(sourcePath, doc.toString())
}

/**
 * Apply position updates to a parsed Document in place. Exported for unit
 * testing — production callers should prefer writeTemplatePositions.
 */
export function applyPositions(doc: Document, positions: PositionMap): void {
  const nodes = doc.get('nodes')
  if (!isSeq(nodes)) throw new Error('template has no nodes sequence')

  const idsInYaml = new Set<string>()
  for (const item of nodes.items) {
    if (!isMap(item)) continue
    const id = item.get('id')
    if (typeof id === 'string') idsInYaml.add(id)
  }
  for (const id of Object.keys(positions)) {
    if (!idsInYaml.has(id)) {
      throw new Error(`unknown node id in positions: ${id}`)
    }
  }

  for (const item of nodes.items) {
    if (!isMap(item)) continue
    const id = item.get('id')
    if (typeof id !== 'string') continue
    const pos = positions[id]
    if (!pos) continue
    item.set('position', doc.createNode(pos, { flow: true }))
  }
}

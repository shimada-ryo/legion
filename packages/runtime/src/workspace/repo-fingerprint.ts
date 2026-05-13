import { basename, resolve } from 'node:path'
import { createHash } from 'node:crypto'

export function repoFingerprint(repoPath: string): string {
  const absolute = resolve(repoPath)
  const name = basename(absolute)
  const hash = createHash('sha1').update(absolute).digest('hex').slice(0, 8)
  return `${name}-${hash}`
}

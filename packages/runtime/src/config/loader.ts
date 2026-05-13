import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { LegionConfig } from '@legion/core'

export async function loadLegionConfig(repoPath: string): Promise<LegionConfig> {
  const path = join(repoPath, '.legion.yaml')
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
  const parsed = parseYaml(raw) as unknown
  return validate(parsed)
}

function validate(parsed: unknown): LegionConfig {
  if (parsed == null) return {}
  if (typeof parsed !== 'object') {
    throw new Error('.legion.yaml: top-level must be an object')
  }
  const cfg = parsed as Record<string, unknown>
  const out: LegionConfig = {}
  if (cfg.worktree !== undefined) {
    if (typeof cfg.worktree !== 'object' || cfg.worktree === null) {
      throw new Error('.legion.yaml: worktree must be an object')
    }
    const wt = cfg.worktree as Record<string, unknown>
    const setupArr = ensureStringArray(wt.setup, 'worktree.setup')
    const copyArr = ensureStringArray(wt.copyFiles, 'worktree.copyFiles')
    out.worktree = {}
    if (setupArr !== undefined) out.worktree.setup = setupArr
    if (copyArr !== undefined) out.worktree.copyFiles = copyArr
    if (wt.ports !== undefined) {
      if (typeof wt.ports !== 'object' || wt.ports === null) {
        throw new Error('.legion.yaml: worktree.ports must be an object (reserved)')
      }
      out.worktree.ports = wt.ports as Record<string, unknown>
    }
  }
  return out
}

function ensureStringArray(v: unknown, key: string): string[] | undefined {
  if (v === undefined) return undefined
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new Error(`.legion.yaml: ${key} must be an array of strings`)
  }
  return v
}

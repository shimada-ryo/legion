import { cleanupCommand } from './commands/cleanup'

export const CLI_VERSION = '0.0.0'

export async function runCli(args: string[]): Promise<void> {
  const [cmd, ...rest] = args
  if (cmd === '--version' || cmd === '-v') {
    console.log(CLI_VERSION)
    return
  }
  if (cmd === undefined || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(
      'legion <command>\n\nCommands:\n  cleanup [--yes] [--workflow <id>]   Remove worktrees and branches',
    )
    return
  }
  if (cmd === 'cleanup') {
    const yes = rest.includes('--yes')
    const wfFlagIdx = rest.indexOf('--workflow')
    const workflowInstanceId = wfFlagIdx >= 0 ? rest[wfFlagIdx + 1] : undefined
    await cleanupCommand({
      repoPath: process.cwd(),
      ...(workflowInstanceId !== undefined ? { workflowInstanceId } : {}),
      yes,
    })
    return
  }
  throw new Error(`Unknown command: ${cmd}`)
}

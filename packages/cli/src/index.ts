export const CLI_VERSION = '0.0.0'

export async function runCli(args: string[]): Promise<void> {
  const [cmd] = args
  if (cmd === '--version' || cmd === '-v') {
    console.log(CLI_VERSION)
    return
  }
  if (cmd === undefined || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(
      'legion <command>\n\nCommands:\n  cleanup     Remove worktrees and branches',
    )
    return
  }
  if (cmd === 'cleanup') {
    throw new Error('cleanup: not yet implemented (Task 15)')
  }
  throw new Error(`Unknown command: ${cmd}`)
}

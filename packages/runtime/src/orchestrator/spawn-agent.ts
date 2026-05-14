import { defaultSystemPromptFor } from '../adapter/role-prompts'

export function buildInitialPrompt(input: { role: string; userPrompt: string }): string {
  const sys = defaultSystemPromptFor(input.role)
  if (sys) return `${sys}\n\nTask: ${input.userPrompt}`
  return [
    `You are operating as the "${input.role}" role in a legion workflow.`,
    `Your task:`,
    input.userPrompt,
  ].join('\n\n')
}

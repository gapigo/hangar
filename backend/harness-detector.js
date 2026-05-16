import { execSync } from 'child_process'

const HARNESSES = [
  { id: 'omp',      name: 'Oh-My-Pi',    command: 'omp' },
  { id: 'claude',   name: 'Claude Code', command: 'claude' },
  { id: 'codex',    name: 'Codex',       command: 'codex' },
  { id: 'opencode', name: 'OpenCode',    command: 'opencode' },
  { id: 'pi',       name: 'Pi',          command: 'pi' },
]

export function detectHarnesses() {
  return HARNESSES.map(h => {
    try {
      execSync(`where ${h.command}`, { stdio: 'ignore' })
      return { ...h, available: true }
    } catch {
      return { ...h, available: false }
    }
  })
}

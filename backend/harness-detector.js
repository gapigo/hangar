import { execSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import yaml from 'js-yaml'

const HARNESSES = [
  { id: 'omp', name: 'Oh-My-Pi', command: 'omp', configPath: join(homedir(), '.omp', 'agent') },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', configPath: join(homedir(), '.config', 'opencode') },
  { id: 'pi', name: 'Pi', command: 'pi', configPath: null },
]

function isAvailable(cmd) {
  try {
    execSync(`where ${cmd}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function detectHarnesses() {
  return HARNESSES.map(h => ({ ...h, available: isAvailable(h.command) }))
}

export function readModels() {
  // Lê modelos do omp
  const ompModelsPath = join(homedir(), '.omp', 'agent', 'models.yml')
  const models = []

  if (existsSync(ompModelsPath)) {
    try {
      const raw = readFileSync(ompModelsPath, 'utf8')
      const parsed = yaml.load(raw)
      for (const [providerId, provider] of Object.entries(parsed?.providers || {})) {
        for (const model of provider?.models || []) {
          models.push({
            id: `${providerId}/${model.id}`,
            name: model.name || model.id,
            provider: providerId,
            harness: 'omp',
          })
        }
      }
    } catch (e) {
      console.error('Error reading omp models:', e.message)
    }
  }

  // Lê roles do omp config para saber o modelo default atual
  const ompConfigPath = join(homedir(), '.omp', 'agent', 'config.yml')
  let defaultModel = null
  if (existsSync(ompConfigPath)) {
    try {
      const raw = readFileSync(ompConfigPath, 'utf8')
      const parsed = yaml.load(raw)
      defaultModel = parsed?.modelRoles?.default || null
    } catch {}
  }

  return { models, defaultModel }
}

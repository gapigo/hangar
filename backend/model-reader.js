import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import yaml from 'js-yaml'

const OMP_MODELS_PATH = join(homedir(), '.omp', 'agent', 'models.yml')

export function readModels() {
  if (!existsSync(OMP_MODELS_PATH)) {
    return [
      { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      { id: 'deepseek/deepseek-v4-pro',   name: 'DeepSeek V4 Pro' },
    ]
  }
  const raw = readFileSync(OMP_MODELS_PATH, 'utf8')
  const parsed = yaml.load(raw)
  const models = []
  for (const [providerId, provider] of Object.entries(parsed.providers || {})) {
    for (const model of provider.models || []) {
      models.push({
        id: `${providerId}/${model.id}`,
        name: model.name || model.id,
        provider: providerId,
      })
    }
  }
  return models
}

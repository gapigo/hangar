import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const DATA_DIR = join(homedir(), '.hangar')
const DATA_FILE = join(DATA_DIR, 'projects.json')

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

function readStore() {
  ensureDir()
  if (!existsSync(DATA_FILE)) return { projects: [] }
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf-8'))
  } catch {
    return { projects: [] }
  }
}

function writeStore(data) {
  ensureDir()
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

export const store = {
  list() {
    return readStore().projects
  },
  get(id) {
    return readStore().projects.find((p) => p.id === id) || null
  },
  create({ name, path, model, harness }) {
    const data = readStore()
    const project = {
      id: crypto.randomUUID(),
      name,
      path,
      model: model || '',
      harness: harness || 'omp',
      status: 'idle',
      output: [],
      createdAt: new Date().toISOString(),
    }
    data.projects.push(project)
    writeStore(data)
    return project
  },
  update(id, changes) {
    const data = readStore()
    const idx = data.projects.findIndex((p) => p.id === id)
    if (idx === -1) return null
    data.projects[idx] = { ...data.projects[idx], ...changes }
    writeStore(data)
    return data.projects[idx]
  },
  delete(id) {
    const data = readStore()
    data.projects = data.projects.filter((p) => p.id !== id)
    writeStore(data)
  },
  appendOutput(id, line) {
    const data = readStore()
    const idx = data.projects.findIndex((p) => p.id === id)
    if (idx === -1) return
    data.projects[idx].output = [...(data.projects[idx].output || []), line].slice(-500)
    writeStore(data)
  },
}

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'

const DATA_DIR = join(homedir(), '.hangar')
const PROJECTS_FILE = join(DATA_DIR, 'projects.json')
const ARCHIVE_DIR = join(DATA_DIR, 'archive')
const TRASH_DIR = join(DATA_DIR, 'trash')

function ensureDirs() {
  for (const dir of [DATA_DIR, ARCHIVE_DIR, TRASH_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

function load() {
  ensureDirs()
  if (!existsSync(PROJECTS_FILE)) return []
  try {
    const raw = JSON.parse(readFileSync(PROJECTS_FILE, 'utf8'))
    // Backward compat: old format stored { projects: [...] }
    return Array.isArray(raw) ? raw : raw.projects || []
  } catch { return [] }
}

function save(projects) {
  ensureDirs()
  writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2))
}

// Auto-limpeza de lixeira após 3 dias
function cleanTrash() {
  if (!existsSync(TRASH_DIR)) return
  const files = readdirSync(TRASH_DIR)
  const threeDays = 3 * 24 * 60 * 60 * 1000
  for (const f of files) {
    const p = join(TRASH_DIR, f)
    try {
      const stat = statSync(p)
      if (Date.now() - stat.mtimeMs > threeDays) unlinkSync(p)
    } catch {
      // ignore stale entries
    }
  }
}
cleanTrash()

export const store = {
  list() { return load() },

  get(id) { return load().find(p => p.id === id) },

  create(data) {
    const projects = load()
    const project = {
      id: randomUUID(),
      name: data.name,
      path: data.path,
      harness: data.harness || 'omp',
      model: data.model || '',
      status: 'idle',
      createdAt: new Date().toISOString(),
      lastHarness: data.harness || 'omp',
      lastModel: data.model || '',
      lastPrompt: '',
    }
    projects.push(project)
    save(projects)
    return project
  },

  update(id, data) {
    const projects = load()
    const i = projects.findIndex(p => p.id === id)
    if (i === -1) return null
    projects[i] = { ...projects[i], ...data }
    save(projects)
    return projects[i]
  },

  // Salva última sessão (harness + model + prompt) para pré-popular o modal
  saveLastSession(id, { harness, model, prompt }) {
    return this.update(id, { lastHarness: harness, lastModel: model, lastPrompt: prompt })
  },

  archive(id) {
    const projects = load()
    const i = projects.findIndex(p => p.id === id)
    if (i === -1) return null
    const project = projects[i]
    writeFileSync(
      join(ARCHIVE_DIR, `${id}.json`),
      JSON.stringify({ ...project, archivedAt: new Date().toISOString() }, null, 2)
    )
    projects.splice(i, 1)
    save(projects)
    return { ok: true }
  },

  delete(id) {
    const projects = load()
    const i = projects.findIndex(p => p.id === id)
    if (i === -1) return null
    const project = projects[i]
    writeFileSync(
      join(TRASH_DIR, `${id}.json`),
      JSON.stringify({ ...project, deletedAt: new Date().toISOString() }, null, 2)
    )
    projects.splice(i, 1)
    save(projects)
    return { ok: true }
  },

  listArchive() {
    if (!existsSync(ARCHIVE_DIR)) return []
    return readdirSync(ARCHIVE_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => JSON.parse(readFileSync(join(ARCHIVE_DIR, f), 'utf8')))
  },
}

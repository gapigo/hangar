const BASE = 'http://localhost:3333/api'

export const api = {
  getHarnesses: () =>
    fetch(BASE + '/harnesses').then((r) => r.json()) as Promise<Harness[]>,

  getModels: () =>
    fetch(BASE + '/models')
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? data : data.models || [])) as Promise<ModelInfo[]>,

  getProjects: () =>
    fetch(BASE + '/projects').then((r) => r.json()) as Promise<Project[]>,

  createProject: (data: { name: string; path: string; model: string; harness?: string }) =>
    fetch(BASE + '/projects', {
      method: 'POST',
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' },
    }).then((r) => r.json()) as Promise<Project>,

  startProject: (id: string, body?: { prompt?: string; harness?: string; model?: string }) =>
    fetch(BASE + '/projects/' + id + '/start', {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
    }).then((r) => r.json()),

  stopProject: (id: string) =>
    fetch(BASE + '/projects/' + id + '/stop', { method: 'POST' }).then((r) => r.json()),

  archiveProject: (id: string) =>
    fetch(BASE + '/projects/' + id + '/archive', { method: 'POST' }).then((r) => r.json()),

  deleteProject: (id: string) =>
    fetch(BASE + '/projects/' + id, { method: 'DELETE' }).then((r) => r.json()),

  updateProject: (id: string, data: Record<string, unknown>) =>
    fetch(BASE + '/projects/' + id, {
      method: 'PATCH',
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' },
    }).then((r) => r.json()) as Promise<Project>,

  getArchive: () =>
    fetch(BASE + '/archive').then((r) => r.json()) as Promise<Project[]>,

  resizeTerminal: (id: string, cols: number, rows: number) =>
    fetch(BASE + '/projects/' + id + '/resize', {
      method: 'POST',
      body: JSON.stringify({ cols, rows }),
      headers: { 'Content-Type': 'application/json' },
    }).then((r) => r.json()),
}

export type Project = {
  id: string
  name: string
  path: string
  model: string
  harness?: string
  status: 'idle' | 'running' | 'paused' | 'done'
  createdAt: string
  lastHarness?: string
  lastModel?: string
  lastPrompt?: string
  archivedAt?: string
  deletedAt?: string
}

export type Harness = {
  id: string
  name: string
  command: string
  available: boolean
  configPath?: string
}

export type ModelInfo = {
  id: string
  name: string
  provider?: string
  harness?: string
}

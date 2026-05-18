import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import cors from 'cors'
import { store } from './project-store.js'
import { manager } from './session-manager.js'
import { detectHarnesses, readModels } from './harness-detector.js'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'


// Reset any stale "running" statuses from previous crashes
store.resetRunning()
const app = express()
app.use(cors())
app.use(express.json())

// Harnesses e models
app.get('/api/harnesses', (_, res) => res.json(detectHarnesses()))
app.get('/api/models', (_, res) => res.json(readModels()))
// Config
app.get('/api/config', (_, res) => res.json({ homeDir: homedir() }))

// Projects CRUD
app.get('/api/projects', (_, res) => res.json(store.list()))
app.post('/api/projects', (req, res) => res.json(store.create(req.body)))
app.patch('/api/projects/:id', (req, res) => {
  const p = store.update(req.params.id, req.body)
  if (!p) return res.status(404).json({ error: 'not found' })
  res.json(p)
})

// Archive e Delete
app.post('/api/projects/:id/archive', (req, res) => {
  const r = store.archive(req.params.id)
  if (!r) return res.status(404).json({ error: 'not found' })
  manager.stop(req.params.id)
  res.json(r)
})

app.delete('/api/projects/:id', (req, res) => {
  const r = store.delete(req.params.id)
  if (!r) return res.status(404).json({ error: 'not found' })
  manager.stop(req.params.id)
  res.json(r)
})

app.get('/api/archive', (_, res) => res.json(store.listArchive()))

// Start: spawna PTY real
app.post('/api/projects/:id/start', (req, res) => {
  const p = store.get(req.params.id)
  if (!p) return res.status(404).json({ error: 'not found' })
  const { prompt, harness, model } = req.body || {}
  // Atualiza projeto com harness/model escolhidos
  store.update(p.id, { harness: harness || p.harness, model: model || p.model, status: 'running' })
  store.saveLastSession(p.id, { harness: harness || p.harness, model: model || p.model, prompt: prompt || '' })
  const updatedProject = store.get(p.id)
  manager.start(updatedProject, prompt)
  res.json({ ok: true })
})

// Stop
app.post('/api/projects/:id/stop', (req, res) => {
  manager.stop(req.params.id)
  store.update(req.params.id, { status: 'idle' })
  res.json({ ok: true })
})

// Resize terminal
app.post('/api/projects/:id/resize', (req, res) => {
  const { cols, rows } = req.body
  manager.resize(req.params.id, cols, rows)
  res.json({ ok: true })
})

// SSE global — status updates
const sseClients = new Set()
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  // Heartbeat a cada 15s — evita timeout do browser/proxy
  const interval = setInterval(() => res.write(': heartbeat\n\n'), 15000)
  sseClients.add(res)
  req.on('close', () => { sseClients.delete(res); clearInterval(interval) })
  res.on('error', () => { sseClients.delete(res); clearInterval(interval) })
})

manager.on('status', (id, status) => {
  store.update(id, { status })
  const data = `data: ${JSON.stringify({ type: 'status', id, status })}\n\n`
  for (const res of sseClients) res.write(data)
})

// Static frontend serving + SPA fallback
const __dirname = dirname(fileURLToPath(import.meta.url))
const frontendDist = join(__dirname, '..', 'frontend', 'dist')

if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist))
  app.get('*', (_, res) => {
    res.sendFile(join(frontendDist, 'index.html'))
  })
  console.log('📦  Serving frontend from', frontendDist)
}
// WebSocket — terminal PTY bidirecional
const server = createServer(app)
const wss = new WebSocketServer({ server })

wss.on('connection', (ws, req) => {
  const id = req.url.replace('/sessions/', '')
  manager.addClient(id, ws)
  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw)
      if (msg.type === 'input') manager.send(id, msg.data)
      if (msg.type === 'resize') manager.resize(id, msg.cols, msg.rows)
    } catch {
      manager.send(id, raw.toString())
    }
  })
  ws.on('close', () => manager.removeClient(id, ws))
})

server.listen(3333, () => console.log('✈️  Hangar backend: http://localhost:3333'))

import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import cors from 'cors'
import { store } from './project-store.js'
import { manager } from './session-manager.js'
import { detectHarnesses, readModels } from './harness-detector.js'

const app = express()
app.use(cors())
app.use(express.json())

// Harnesses e models
app.get('/api/harnesses', (_, res) => res.json(detectHarnesses()))
app.get('/api/models', (_, res) => res.json(readModels()))

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
  // Heartbeat a cada 30s
  const interval = setInterval(() => res.write(': ping\n\n'), 30000)
  sseClients.add(res)
  req.on('close', () => { sseClients.delete(res); clearInterval(interval) })
})

manager.on('status', (id, status) => {
  store.update(id, { status })
  const data = `data: ${JSON.stringify({ type: 'status', id, status })}\n\n`
  for (const res of sseClients) res.write(data)
})

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

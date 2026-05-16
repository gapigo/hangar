import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import cors from 'cors'
import { store } from './project-store.js'
import { manager } from './session-manager.js'
import { detectHarnesses } from './harness-detector.js'
import { readModels } from './model-reader.js'

const app = express()
app.use(cors())
app.use(express.json())

// Available harnesses
app.get('/api/harnesses', (req, res) => res.json(detectHarnesses()))

// Available models
app.get('/api/models', (req, res) => res.json(readModels()))

// Projects CRUD
app.get('/api/projects', (req, res) => res.json(store.list()))

app.post('/api/projects', (req, res) => {
  const p = store.create(req.body)
  res.json(p)
})

app.patch('/api/projects/:id', (req, res) => {
  const p = store.update(req.params.id, req.body)
  if (!p) return res.status(404).json({ error: 'not found' })
  res.json(p)
})

app.delete('/api/projects/:id', (req, res) => {
  manager.stop(req.params.id)
  store.delete(req.params.id)
  res.json({ ok: true })
})

// Start: spawns real process
app.post('/api/projects/:id/start', (req, res) => {
  const p = store.get(req.params.id)
  if (!p) return res.status(404).json({ error: 'not found' })
  const { prompt, harness, model } = req.body || {}
  // Update harness/model if provided
  const updates = {}
  if (harness) updates.harness = harness
  if (model) updates.model = model
  if (Object.keys(updates).length) store.update(p.id, updates)
  const project = { ...p, ...updates }
  manager.start(project, prompt)
  store.update(p.id, { status: 'running' })
  res.json({ ok: true })
})

// Stop: kills process
app.post('/api/projects/:id/stop', (req, res) => {
  manager.stop(req.params.id)
  store.update(req.params.id, { status: 'idle' })
  res.json({ ok: true })
})

// Listen to session manager events → update store + broadcast
manager.on('status', (id, status) => {
  store.update(id, { status })
  broadcastGlobal({ type: 'status', id, status })
})

// SSE — frontend listens for project status changes
const sseClients = new Set()
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  sseClients.add(res)
  req.on('close', () => sseClients.delete(res))
})

function broadcastGlobal(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`
  for (const res of sseClients) {
    try { res.write(msg) } catch {}
  }
}

// WebSocket for individual sessions
const server = createServer(app)
const wss = new WebSocketServer({ server })

wss.on('connection', (ws, req) => {
  const id = req.url.replace('/sessions/', '')
  manager.addClient(id, ws)
  ws.on('message', (data) => manager.send(id, data.toString()))
  ws.on('close', () => manager.removeClient(id, ws))
})

server.listen(3333, () => console.log('Hangar: http://localhost:3333'))

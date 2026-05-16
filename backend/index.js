import express from 'express'
import { WebSocketServer } from 'ws'
import cors from 'cors'
import { createServer } from 'http'
import { store } from './project-store.js'
import { manager } from './session-manager.js'

const app = express()
app.use(cors())
app.use(express.json())

// REST API
app.get('/api/projects', (req, res) => {
  res.json(store.list())
})

app.post('/api/projects', (req, res) => {
  res.json(store.create(req.body))
})

app.patch('/api/projects/:id', (req, res) => {
  const p = store.update(req.params.id, req.body)
  if (!p) return res.status(404).json({ error: 'Not found' })
  res.json(p)
})

app.delete('/api/projects/:id', (req, res) => {
  manager.stop(req.params.id)
  store.delete(req.params.id)
  res.json({ ok: true })
})

app.post('/api/projects/:id/start', (req, res) => {
  const p = store.get(req.params.id)
  if (!p) return res.status(404).json({ error: 'Not found' })
  manager.start(p)
  store.update(p.id, { status: 'running' })
  res.json({ ok: true })
})

app.post('/api/projects/:id/stop', (req, res) => {
  manager.stop(req.params.id)
  store.update(req.params.id, { status: 'idle' })
  res.json({ ok: true })
})

// WebSocket
const server = createServer(app)
const wss = new WebSocketServer({ server })

wss.on('connection', (ws, req) => {
  const id = req.url.replace('/sessions/', '')
  manager.addClient(id, ws)

  ws.on('message', (data) => {
    manager.send(id, data.toString())
  })

  ws.on('close', () => {
    manager.removeClient(id, ws)
  })
})

server.listen(3333, () => {
  console.log('Hangar backend: http://localhost:3333')
})

import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import cors from 'cors'
import { store } from './project-store.js'
import { manager } from './session-manager.js'
import { detectHarnesses, readModels } from './harness-detector.js'
import { existsSync, writeFileSync } from 'fs'
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

// Artifacts
app.get('/api/projects/:id/artifacts', (req, res) => {
  const session = manager.getSession(req.params.id)
  if (!session?.parser) return res.json([])
  res.json(session.parser.getArtifacts())
})

// Comentar uma linha de um artifact
app.post('/api/projects/:id/artifacts/:artifactId/comments', (req, res) => {
  const session = manager.getSession(req.params.id)
  if (!session?.parser) return res.status(404).json({ error: 'no session' })
  const { lineIndex, text } = req.body
  const comment = session.parser.addComment(req.params.artifactId, lineIndex, text)
  if (!comment) return res.status(404).json({ error: 'artifact not found' })
  // Notifica SSE
  const sseData = `data: ${JSON.stringify({ type: 'comment-added', projectId: req.params.id, artifactId: req.params.artifactId, comment })}\n\n`
  for (const sse of sseClients) sse.write(sseData)
  res.json(comment)
})

// Resolver um comentário
app.post('/api/projects/:id/artifacts/:artifactId/comments/:commentId/resolve', (req, res) => {
  const session = manager.getSession(req.params.id)
  if (!session?.parser) return res.status(404).json({ error: 'no session' })
  const c = session.parser.resolveComment(req.params.artifactId, req.params.commentId)
  res.json(c || { error: 'not found' })
})

// Send feedback: injeta todos os comentários pendentes no PTY stdin
app.post('/api/projects/:id/feedback', (req, res) => {
  const session = manager.getSession(req.params.id)
  if (!session?.parser) return res.status(404).json({ error: 'no session' })
  const xml = session.parser.serializeCommentsAsXML()
  if (!xml) return res.json({ ok: true, injected: false, message: 'no pending comments' })
  // Injeta como se o usuário tivesse digitado — com \n para submeter
  manager.send(req.params.id, '\n' + xml + '\n')
  // Marca todos como resolvidos
  for (const { artifact, comment } of session.parser.getPendingComments()) {
    session.parser.resolveComment(artifact.id, comment.id)
  }
  res.json({ ok: true, injected: true, xml })
})


// Pending comment counts for all active sessions (used by Kanban badges)
app.get('/api/projects/pending-comment-counts', (_, res) => {
  const counts = {}
  for (const [id, session] of manager.sessions.entries()) {
    if (session.parser) {
      const pending = session.parser.getPendingComments()
      if (pending.length > 0) counts[id] = pending.length
    }
  }
  res.json(counts)
})
// SSE global — status updates
const sseClients = new Set()
app.get('/api/events', (req, res) => {
	res.setHeader('Content-Type', 'text/event-stream')
	res.setHeader('Cache-Control', 'no-cache')
	res.setHeader('Connection', 'keep-alive')
	res.setHeader('X-Accel-Buffering', 'no')
	res.flushHeaders()
	// Send immediate comment to establish connection
	res.write(': connected\n\n')
	// Heartbeat every 10s — browsers drop before 30s
	const interval = setInterval(() => {
		try {
			res.write(': ping\n\n')
		} catch {
			clearInterval(interval)
			sseClients.delete(res)
		}
	}, 10000)
	sseClients.add(res)
	req.on('close', () => { clearInterval(interval); sseClients.delete(res) })
	req.on('error', () => { clearInterval(interval); sseClients.delete(res) })
	res.on('error', () => { clearInterval(interval); sseClients.delete(res) })
})

manager.on('status', (id, status) => {
  store.update(id, { status })
  const data = `data: ${JSON.stringify({ type: 'status', id, status })}\n\n`
  for (const res of sseClients) res.write(data)
})

manager.on('artifact', (projectId, artifact) => {
  const data = `data: ${JSON.stringify({ type: 'artifact', projectId, artifact })}\n\n`
  for (const sse of sseClients) sse.write(data)
})

manager.on('artifact-update', (projectId, artifactId, artifact) => {
  const data = `data: ${JSON.stringify({ type: 'artifact-update', projectId, artifactId, artifact })}\n\n`
  for (const sse of sseClients) sse.write(data)
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


async function startServer() {
  const preferred = parseInt(process.env.PORT || '3333', 10)
  for (let port = preferred; port < preferred + 100; port++) {
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, () => {
          server.removeListener('error', reject)
          resolve()
        })
      })
      console.log(`✈️  Hangar backend: http://localhost:${port}`)
      writeFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.port'), String(port))
      return
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e
    }
  }
  throw new Error('No available port found')
}

startServer()

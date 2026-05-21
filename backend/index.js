import express from 'express'
import { networkInterfaces } from 'os'

function getLanIP() {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const i of ifaces) {
      if (i.family === 'IPv4' && !i.internal) return i.address
    }
  }
  return 'localhost'
}
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import cors from 'cors'
import { store } from './project-store.js'
import { manager } from './session-manager.js'
import { startDiscordBot, notifyDiscord } from './discord-bot.js'
import { startWhatsAppBot, notifyWhatsApp, getWhatsAppQR, getWhatsAppStatus } from './whatsapp-bot.js'
import { detectHarnesses, readModels } from './harness-detector.js'
import { existsSync, writeFileSync, readFileSync, createReadStream, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { randomUUID } from 'crypto'

// Auth: generate token on first startup
const HANGAR_DIR = join(homedir(), '.hangar')
const AUTH_PATH = join(HANGAR_DIR, 'auth.json')
mkdirSync(HANGAR_DIR, { recursive: true })
let auth = { token: '' }
if (existsSync(AUTH_PATH)) {
  try { auth = JSON.parse(readFileSync(AUTH_PATH, 'utf8')) } catch {}
}
if (!auth.token) {
  auth.token = randomUUID()
  writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2))
}

// Auth middleware: token required for external IPs
const isLocalIP = (ip) => {
  // Strip IPv4-mapped IPv6 prefix (::ffff:192.168.x.x → 192.168.x.x)
  const addr = (ip || '').replace(/^::ffff:/, '')
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr === 'localhost' ||
    /^192\.168\./.test(addr) ||
    /^10\./.test(addr) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(addr)
  )
}



// Reset any stale "running" statuses from previous crashes
store.resetRunning()
const app = express()
app.use(cors())
app.use(express.json())

// Auth middleware: token required for external IPs
app.use('/api', (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || ''
  if (isLocalIP(ip)) return next()
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token
  if (token === auth.token) return next()
  if (req.path === '/tunnel' && req.method === 'GET') return next()
  res.status(401).json({ error: 'unauthorized' })
})

// Harnesses e models
app.get('/api/harnesses', (_, res) => res.json(detectHarnesses()))
app.get('/api/models', (_, res) => res.json(readModels()))
// Config
app.get('/api/config', (_, res) => res.json({ homeDir: homedir(), lanIP: getLanIP() }))

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
  if (session?.parser) return res.json(session.parser.getArtifacts())
  // Fallback: read from persisted JSONL
  const logPath = join(homedir(), '.hangar', 'artifacts', `${req.params.id}.jsonl`)
  if (!existsSync(logPath)) return res.json([])
  try {
    const lines = readFileSync(logPath, 'utf8').trim().split('\n')
    const artifacts = lines.slice(-200).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    res.json(artifacts)
  } catch { res.json([]) }
})

// Inject text into PTY (WhatsApp bot /send command)
app.post('/api/projects/:id/send', (req, res) => {
  const { data } = req.body || {}
  if (!data) return res.status(400).json({ error: 'missing data' })
  const session = manager.getSession(req.params.id)
  if (!session) return res.status(404).json({ error: 'session not running' })
  manager.send(req.params.id, data)
  res.json({ ok: true })
})

// Terminal buffer output (WhatsApp bot /logs /screenshot)
app.get('/api/projects/:id/terminal', (req, res) => {
  const session = manager.getSession(req.params.id)
  const limit = parseInt(req.query.lines) || 20
  if (!session?.buffer) return res.json([])
  const buffer = session.buffer.join('').split('\n').map(l => l.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''))
  res.json(buffer.slice(-limit))
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

// Session buffer (for mobile terminal log view)
app.get('/api/projects/:id/buffer', (req, res) => {
  const session = manager.getSession(req.params.id)
  if (!session) return res.json({ lines: [] })
  const n = Math.min(parseInt(req.query.n) || 100, 500)
  const raw = session.buffer.slice(-n * 5).join('')
  const clean = raw
    .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1B\][^\x07\x1B]*(\x07|\x1B\\)/g, '')
  const lines = clean.split('\n').filter(l => l.trim()).slice(-n)
  res.json({ lines })
})

// Tunnel status
app.get('/api/tunnel', (_, res) => {
  const tp = join(HANGAR_DIR, 'tunnel.json')
  if (existsSync(tp)) {
    try { return res.json(JSON.parse(readFileSync(tp, 'utf8'))) } catch {}
  }
  res.json({ url: null, publicUrl: null, active: false })
})
// Tunnel QR code
app.get('/api/tunnel/qr', async (_, res) => {
  const tp = join(HANGAR_DIR, 'tunnel.json')
  if (!existsSync(tp)) return res.json({ qr: null })
  try {
    const { publicUrl } = JSON.parse(readFileSync(tp, 'utf8'))
    if (!publicUrl) return res.json({ qr: null })
    const QRCode = (await import('qrcode')).default
    const qr = await QRCode.toDataURL(publicUrl, { width: 256, margin: 2 })
    res.json({ qr })
  } catch { res.json({ qr: null }) }
})

// Auth: get token
app.get('/api/auth/token', (_, res) => res.json({ token: auth.token }))

// Auth: regenerate token
app.put('/api/auth/token', (_, res) => {
  auth.token = randomUUID()
  writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2))
  res.json({ token: auth.token })
})

// Auth: full status (for Settings page)
app.get('/api/auth/status', (_, res) => res.json({ ...auth, token: auth.token }))

// Auth: save Discord config
app.put('/api/auth/discord', (req, res) => {
  auth.discordBotToken = req.body.discordBotToken || auth.discordBotToken || ''
  auth.discordChannelId = req.body.discordChannelId || auth.discordChannelId || ''
  auth.discordEnabled = !!req.body.discordEnabled
  writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2))
  res.json({ ok: true })
})

// Auth: save WhatsApp config
app.put('/api/auth/whatsapp', (req, res) => {
  auth.whatsappEnabled = !!req.body.whatsappEnabled
  auth.whatsappPhone = req.body.whatsappPhone || auth.whatsappPhone || ''
  auth.whatsappChatId = req.body.whatsappChatId || auth.whatsappChatId || ''
  writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2))
  res.json({ ok: true })
})

// WhatsApp debug: send test command
app.post('/api/whatsapp/debug', async (req, res) => {
  const { default: mod } = await import('./whatsapp-bot.js')
  // Test the internal handler directly
  try {
    const projects = await fetch(`http://localhost:${server.address().port}/api/projects`).then(r => r.json())
    const lines = projects.map(p => `${p.status === 'running' ? '🟢' : '⚪'} ${p.name} (${p.status})`)
    res.json({ projects: lines, count: lines.length })
  } catch (e) {
    res.json({ error: e.message })
  }
})

// WhatsApp: list chats for group selection
app.get('/api/whatsapp/chats', async (_, res) => {
  const { getChats } = await import('./whatsapp-bot.js')
  res.json(await getChats())
})

// WhatsApp
app.get('/api/whatsapp/qr', (_, res) => res.json(getWhatsAppQR()))
app.get('/api/whatsapp/status', (_, res) => res.json(getWhatsAppStatus()))
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
  const p = store.get(id)
  if (p) notifyWhatsApp(p.name, status)
  if (p) notifyDiscord(p.name, status, { sessionId: id })
})

manager.on('artifact', (projectId, artifact) => {
  const data = `data: ${JSON.stringify({ type: 'artifact', projectId, artifact })}\n\n`
  for (const sse of sseClients) sse.write(data)
  if (artifact.type === 'diff') {
    const p = store.get(projectId)
    if (p) notifyDiscord(p.name, 'diff', { sessionId: projectId })
  }
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
wss.on('error', () => {}) // prevent crash on port conflicts

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
      startDiscordBot(port)
      startWhatsAppBot(port)
      return
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e
    }
  }
  throw new Error('No available port found')
}

startServer()

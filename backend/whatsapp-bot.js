import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { Client, LocalAuth } = require('whatsapp-web.js')
import qrcode from 'qrcode'
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const HANGAR_DIR = join(homedir(), '.hangar')
const AUTH_PATH = join(HANGAR_DIR, 'auth.json')
const SESSION_DIR = join(HANGAR_DIR, 'whatsapp-session')
const QR_PATH = join(HANGAR_DIR, 'whatsapp-qr.json')

let client = null
let apiBase = 'http://localhost:3333/api'
let authorizedPhone = ''
let whatsappChatId = ''
let backendPort = 3333

// ── Rate limiting ──
const rateLimit = new Map() // chatId → lastResponseTime
const RATE_LIMIT_MS = 3000 // 3 seconds between responses per chat

function canRespond(chatId) {
  const last = rateLimit.get(chatId)
  if (last && Date.now() - last < RATE_LIMIT_MS) return false
  return true
}

function markResponded(chatId) {
  rateLimit.set(chatId, Date.now())
}

// ── Helpers ──

async function fetchProjects() {
  return fetch(`${apiBase}/projects`).then(r => r.json())
}

async function findProject(name) {
  const projects = await fetchProjects()
  return name ? projects.find(p => p.name.toLowerCase().includes(name.toLowerCase())) : null
}

async function safeSend(chat, text) {
  try {
    await chat.sendMessage(text.slice(0, 4000))
  } catch (e) {
    console.error('[whatsapp] safeSend error:', e.message)
  }
}

const HELP_TEXT = `📋 *Hangar WhatsApp Commands*

*!status* — List all projects
*!project <name>* — Show project details
*!launch <name> [prompt]* — Start agent session
*!stop <name>* — Stop agent session
*!restart <name>* — Restart a session
*!logs <name> [lines]* — View terminal output (default 20)
*!send <name> <text>* — Inject text into agent terminal
*!artifacts <name>* — Show latest artifacts
*!comment <name> <line> <text>* — Comment on a line
*!screenshot <name>* — Capture terminal output
*!help* — Show this message

In groups, prefix with ! In DMs, prefix is optional.`

// ── Chat list (for Settings dropdown) ──

export async function getChats() {
  if (!client?.info?.wid) return []
  try {
    const chats = await client.getChats()
    return chats.map(c => ({ id: c.id._serialized, name: c.name || c.id.user || c.id._serialized, isGroup: c.isGroup }))
  } catch { return [] }
}

function loadAuth() {
  if (!existsSync(AUTH_PATH)) return null
  try { return JSON.parse(readFileSync(AUTH_PATH, 'utf8')) } catch { return null }
}

export function getWhatsAppStatus() {
  return { connected: client?.info?.wid?.user ? true : false }
}

export function getWhatsAppQR() {
  if (!existsSync(QR_PATH)) return { status: 'no_qr' }
  try { return JSON.parse(readFileSync(QR_PATH, 'utf8')) } catch { return { status: 'error' } }
}

export async function startWhatsAppBot(port) {
  const auth = loadAuth()
  if (!auth?.whatsappEnabled) {
    console.log('[whatsapp] Not enabled — skipping')
    return
  }
  authorizedPhone = auth.whatsappPhone || ''
  whatsappChatId = auth.whatsappChatId || ''
  backendPort = port || 3333
  apiBase = `http://localhost:${backendPort}/api`

  const chromePaths = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ]
  const executablePath = chromePaths.find(p => existsSync(p))

  mkdirSync(SESSION_DIR, { recursive: true })

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
    puppeteer: executablePath ? { executablePath, headless: true, args: ['--no-sandbox'] } : { headless: true, args: ['--no-sandbox'] },
  })

  client.on('qr', async (qr) => {
    console.log('[whatsapp] QR code received — scan to authenticate')
    try {
      const dataURL = await qrcode.toDataURL(qr)
      writeFileSync(QR_PATH, JSON.stringify({ qr: dataURL }))
    } catch (e) {
      console.error('[whatsapp] QR save error:', e.message)
    }
  })

  client.on('authenticated', () => {
    console.log('[whatsapp] Authenticated')
    if (existsSync(QR_PATH)) writeFileSync(QR_PATH, JSON.stringify({ status: 'authenticated' }))
  })

  client.on('ready', () => {
    console.log('[whatsapp] Client ready')
  })

  client.on('disconnected', (reason) => {
    console.log('[whatsapp] DISCONNECTED:', reason)
    appendFileSync(join(HANGAR_DIR, 'whatsapp-debug.log'), `${new Date().toISOString()} DISCONNECTED reason=${reason}\n`)
  })

  client.on('change_state', (state) => {
    console.log('[whatsapp] state:', state)
    appendFileSync(join(HANGAR_DIR, 'whatsapp-debug.log'), `${new Date().toISOString()} state=${state}\n`)
  })

  client.on('auth_failure', (msg) => {
    console.log('[whatsapp] AUTH FAILURE:', msg)
    appendFileSync(join(HANGAR_DIR, 'whatsapp-debug.log'), `${new Date().toISOString()} AUTH_FAILURE msg=${msg}\n`)
  })


  async function processIncoming(msg, isOwn) {
    // 1. Chat filter: only listen in selected chat
    if (whatsappChatId && msg.from !== whatsappChatId) return

    const chat = await msg.getChat()

    // 2. Rate limit
    if (!canRespond(chat.id._serialized)) return

    // 3. Parse command
    const raw = msg.body.trim()
    const body = raw.replace(/^[!/]/, '').trim()
    const [cmd, ...args] = body.split(/\s+/)
    const cmdLower = (cmd || '').toLowerCase()

    // 4. Group prefix check: in groups, require ! or / prefix
    if (chat.isGroup && !/^[!/]/.test(raw.trim())) return

    appendFileSync(join(HANGAR_DIR, 'whatsapp-debug.log'), `${new Date().toISOString()} CMD chat=${chat.id._serialized} isOwn=${isOwn} group=${chat.isGroup} cmd="${cmdLower}" args="${args.join(' ')}"\n`)

    try {
      await executeCommand(chat, cmdLower, args, raw)
      markResponded(chat.id._serialized)
    } catch (e) {
      console.error('[whatsapp] Command error:', e)
      await safeSend(chat, `❌ Error: ${e.message}`)
      markResponded(chat.id._serialized)
    }
  }

  // Incoming messages from others
  client.on('message', async (msg) => {
    if (msg.fromMe) return
    await processIncoming(msg, false)
  })

  // Own messages (self-chat, some groups)
  client.on('message_create', async (msg) => {
    if (!msg.fromMe) return
    await processIncoming(msg, true)
  })

  try {
    await client.initialize()
  } catch (e) {
    console.error('[whatsapp] Init failed:', e.message)
  }
}

// ── Command executor ──

async function executeCommand(chat, cmd, args, raw) {
  switch (cmd) {
    case 'status': {
      const projects = await fetchProjects()
      const lines = projects.map(p => `${p.status === 'running' ? '🟢' : p.status === 'paused' ? '🟡' : '⚪'} *${p.name}* (${p.status}) ${p.harness || ''} · ${(p.model || '').slice(0, 30)}`)
      await safeSend(chat, lines.join('\n') || 'No projects')
      break
    }
    case 'projeto':
    case 'project': {
      const name = args.join(' ')
      const p = await findProject(name)
      if (!p) return await safeSend(chat, `Project "${name}" not found`)
      await safeSend(chat, `📋 *${p.name}*\nStatus: ${p.status}\nModel: ${p.model}\nHarness: ${p.harness || 'none'}\nPath: ${p.path}`)
      break
    }
    case 'launch': {
      const name = args[0]
      const prompt = args.slice(1).join(' ')
      const p = await findProject(name)
      if (!p) return await safeSend(chat, `Project "${name}" not found`)
      await fetch(`${apiBase}/projects/${p.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, harness: p.harness || 'omp', model: p.model })
      })
      await safeSend(chat, `▶️ Launched *${p.name}*`)
      break
    }
    case 'stop': {
      const name = args.join(' ')
      const p = await findProject(name)
      if (!p) return await safeSend(chat, `Project "${name}" not found`)
      await fetch(`${apiBase}/projects/${p.id}/stop`, { method: 'POST' })
      await safeSend(chat, `⏹️ Stopped *${p.name}*`)
      break
    }
    case 'restart': {
      const name = args.join(' ')
      const p = await findProject(name)
      if (!p) return await safeSend(chat, `Project "${name}" not found`)
      await fetch(`${apiBase}/projects/${p.id}/stop`, { method: 'POST' })
      await new Promise(r => setTimeout(r, 1000))
      await fetch(`${apiBase}/projects/${p.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ harness: p.harness || 'omp', model: p.model })
      })
      await safeSend(chat, `🔄 Restarted *${p.name}*`)
      break
    }
    case 'send': {
      const name = args[0]
      const text = args.slice(1).join(' ')
      const p = await findProject(name)
      if (!p) return await safeSend(chat, `Project "${name}" not found`)
      if (!text) return await safeSend(chat, 'Usage: !send <project> <text>')
      // Inject into PTY via WebSocket-like mechanism — use the backend API
      await fetch(`${apiBase}/projects/${p.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: text + '\r' })
      })
      await safeSend(chat, `📤 Sent to *${p.name}*: "${text}"`)
      break
    }
    case 'logs': {
      const name = args[0]
      const n = parseInt(args[1]) || 20
      const p = await findProject(name)
      if (!p) return await safeSend(chat, `Project "${name}" not found`)
      const lines = await fetch(`${apiBase}/projects/${p.id}/terminal?lines=${n}`).then(r => r.json())
      if (!lines || lines.length === 0) return await safeSend(chat, `No terminal output for *${p.name}*`)
      await safeSend(chat, lines.map((l, i) => `${String(i + 1).padStart(2, ' ')}| ${l}`).join('\n').slice(0, 3800))
      break
    }
    case 'artifacts': {
      const name = args.join(' ')
      const p = await findProject(name)
      if (!p) return await safeSend(chat, `Project "${name}" not found`)
      const artifacts = await fetch(`${apiBase}/projects/${p.id}/artifacts`).then(r => r.json())
      const last3 = (artifacts || []).slice(-3)
      if (last3.length === 0) return await safeSend(chat, `No artifacts for *${p.name}*`)
      const text = last3.map(a => `*${a.title}*\n${(a.lines || []).slice(0, 3).join('\n')}`).join('\n\n───\n\n')
      await safeSend(chat, text.slice(0, 3800))
      break
    }
    case 'comment': {
      const name = args[0]
      const lineIndex = parseInt(args[1])
      const text = args.slice(2).join(' ')
      const p = await findProject(name)
      if (!p || isNaN(lineIndex) || !text) return await safeSend(chat, 'Usage: !comment <project> <lineIndex> <text>')
      const artifacts = await fetch(`${apiBase}/projects/${p.id}/artifacts`).then(r => r.json())
      const a = artifacts[artifacts.length - 1]
      if (!a) return await safeSend(chat, `No artifacts for *${p.name}*`)
      await fetch(`${apiBase}/projects/${p.id}/artifacts/${a.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineIndex, text })
      })
      await safeSend(chat, `💬 Commented on *${p.name}* line ${lineIndex}: "${text}"`)
      break
    }
    case 'screenshot':
    case 'screen': {
      const name = args.join(' ')
      const p = await findProject(name)
      if (!p) return await safeSend(chat, `Project "${name}" not found`)
      const data = await fetch(`${apiBase}/projects/${p.id}/terminal?lines=25`).then(r => r.json())
      const lines = data || []
      const framed = '┌' + '─'.repeat(60) + '┐\n' +
        lines.map(l => `│ ${(l || '').replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').slice(0, 58).padEnd(58)} │`).join('\n') +
        '\n└' + '─'.repeat(60) + '┘'
      await safeSend(chat, `📸 *${p.name}* terminal:\n\`\`\`\n${framed.slice(0, 3800)}\n\`\`\``)
      break
    }
    case 'help':
    case '?':
    default:
      await safeSend(chat, HELP_TEXT)
      break
  }
}

export function stopWhatsAppBot() {
  if (client) {
    client.destroy()
    client = null
  }
}

export async function notifyWhatsApp(projectName, type) {
  const auth = loadAuth()
  if (!auth?.whatsappEnabled || !client?.info?.wid) return
  try {
    const contact = await client.getNumberId(authorizedPhone)
    if (!contact) return
    if (type === 'running') {
      await client.sendMessage(contact._serialized, `▶️ *${projectName}* started`)
    } else if (type === 'idle' || type === 'done') {
      await client.sendMessage(contact._serialized, `✅ *${projectName}* finished`)
    }
  } catch (e) {
    console.error('[whatsapp] Notification failed:', e.message)
  }
}

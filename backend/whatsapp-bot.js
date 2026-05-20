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
  apiBase = `http://localhost:${port || 3333}/api`

  // Detect Chrome
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

  client.on('message_create', async (msg) => {
    if (!msg.fromMe) return
    if (whatsappChatId && msg.from !== whatsappChatId) return
    appendFileSync(join(HANGAR_DIR, 'whatsapp-debug.log'), `${new Date().toISOString()} CMD from=${msg.from} body="${msg.body?.substring(0, 80)}"\n`)
    await handleMessage(msg)
  })

  try {
    await client.initialize()
  } catch (e) {
    console.error('[whatsapp] Init failed:', e.message)
  }
}

async function handleMessage(msg) {
  const body = msg.body.trim().toLowerCase()
  try {
    if (body === 'status') {
      const projects = await fetch(`${apiBase}/projects`).then(r => r.json())
      const lines = projects.map(p => `${p.status === 'running' ? '🟢' : p.status === 'paused' ? '🟡' : '⚪'} ${p.name} (${p.status})`)
      await msg.reply(lines.join('\n') || 'No projects')
    } else if (body.startsWith('launch ')) {
      const parts = body.slice(7).split(' ').filter(Boolean)
      const name = parts[0]
      const prompt = parts.slice(1).join(' ')
      const projects = await fetch(`${apiBase}/projects`).then(r => r.json())
      const project = projects.find(p => p.name.toLowerCase().includes(name.toLowerCase()))
      if (!project) return await msg.reply(`Project "${name}" not found`)
      await fetch(`${apiBase}/projects/${project.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, harness: project.harness || 'omp', model: project.model })
      })
      await msg.reply(`▶️ Launched ${project.name}`)
    } else if (body.startsWith('stop ')) {
      const name = body.slice(5)
      const projects = await fetch(`${apiBase}/projects`).then(r => r.json())
      const project = projects.find(p => p.name.toLowerCase().includes(name.toLowerCase()))
      if (!project) return await msg.reply(`Project "${name}" not found`)
      await fetch(`${apiBase}/projects/${project.id}/stop`, { method: 'POST' })
      await msg.reply(`⏹️ Stopped ${project.name}`)
    } else if (body.startsWith('artifacts ')) {
      const name = body.slice(10)
      const projects = await fetch(`${apiBase}/projects`).then(r => r.json())
      const project = projects.find(p => p.name.toLowerCase().includes(name.toLowerCase()))
      if (!project) return await msg.reply(`Project "${name}" not found`)
      const artifacts = await fetch(`${apiBase}/projects/${project.id}/artifacts`).then(r => r.json())
      const last2 = (artifacts || []).slice(-2)
      if (last2.length === 0) return await msg.reply(`No artifacts for ${project.name}`)
      const text = last2.map(a => `*${a.title}*\n${(a.lines || []).slice(0, 2).join('\n')}`).join('\n\n')
      await msg.reply(text.slice(0, 2000))
    }
  } catch (e) {
    console.error('[whatsapp] Message error:', e.message)
  }
}

export function stopWhatsAppBot() {
  if (client) {
    client.destroy()
    client = null
  }
}

// WhatsApp notifications
export async function notifyWhatsApp(projectName, type) {
  const auth = loadAuth()
  if (!auth?.whatsappEnabled || !client?.info?.wid) return
  const phone = authorizedPhone + '@c.us'
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

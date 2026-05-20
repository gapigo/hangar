import { Client, GatewayIntentBits, REST, Routes, EmbedBuilder } from 'discord.js'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const AUTH_PATH = join(homedir(), '.hangar', 'auth.json')

function loadAuth() {
  if (!existsSync(AUTH_PATH)) return null
  try { return JSON.parse(readFileSync(AUTH_PATH, 'utf8')) } catch { return null }
}

let client = null
let apiBase = 'http://localhost:3333/api'

export async function startDiscordBot(port) {
  const auth = loadAuth()
  if (!auth?.discordEnabled || !auth?.discordBotToken) {
    console.log('[discord] Not configured — skipping')
    return
  }
  apiBase = `http://localhost:${port || 3333}/api`
  const { discordBotToken, discordChannelId } = auth

  client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] })

  client.on('ready', () => {
    console.log(`[discord] Logged in as ${client.user.tag}`)
    registerCommands(discordBotToken)
  })

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return
    await handleCommand(interaction, auth)
  })

  client.on('messageCreate', (msg) => {
    if (msg.author.bot) return
    // Future: natural language commands
  })

  try {
    await client.login(discordBotToken)
  } catch (e) {
    console.error('[discord] Login failed:', e.message)
  }
}

async function registerCommands(token) {
  const commands = [
    { name: 'status', description: 'List all projects and their statuses' },
    { name: 'launch', description: 'Start an agent session', options: [
      { name: 'project', description: 'Project name', type: 3, required: true },
      { name: 'prompt', description: 'Initial prompt', type: 3, required: false },
    ]},
    { name: 'stop', description: 'Stop a running session', options: [
      { name: 'project', description: 'Project name', type: 3, required: true },
    ]},
    { name: 'artifacts', description: 'Show recent artifacts', options: [
      { name: 'project', description: 'Project name', type: 3, required: true },
    ]},
  ]
  try {
    const rest = new REST({ version: '10' }).setToken(token)
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands })
    console.log('[discord] Slash commands registered')
  } catch (e) {
    console.error('[discord] Command registration failed:', e.message)
  }
}

async function handleCommand(interaction, auth) {
  const { commandName, options } = interaction
  try {
    if (commandName === 'status') return await cmdStatus(interaction)
    const projectName = options.getString('project')
    const projects = await fetch(`${apiBase}/projects`).then(r => r.json())
    const project = projects.find(p => p.name.toLowerCase().includes(projectName.toLowerCase()))
    if (!project) return await interaction.reply({ content: `Project "${projectName}" not found.`, ephemeral: true })

    if (commandName === 'launch') {
      const prompt = options.getString('prompt') || ''
      await fetch(`${apiBase}/projects/${project.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, harness: project.harness || 'omp', model: project.model })
      })
      return await interaction.reply(`\u25B6\uFE0F Launched **${project.name}**`)
    }
    if (commandName === 'stop') {
      await fetch(`${apiBase}/projects/${project.id}/stop`, { method: 'POST' })
      return await interaction.reply(`\u23F9\uFE0F Stopped **${project.name}**`)
    }
    if (commandName === 'artifacts') {
      const artifacts = await fetch(`${apiBase}/projects/${project.id}/artifacts`).then(r => r.json())
      const last3 = (artifacts || []).slice(-3)
      if (last3.length === 0) return await interaction.reply(`No artifacts for **${project.name}** yet.`)
      const lines = last3.map(a => `**${a.title}**\n${(a.lines || []).slice(0, 3).join('\n')}`).join('\n\n---\n\n')
      return await interaction.reply({ content: `Artifacts for **${project.name}**:\n\n${lines}`.slice(0, 1900), ephemeral: true })
    }
  } catch (e) {
    console.error('[discord] Command error:', e)
    await interaction.reply({ content: 'Error processing command.', ephemeral: true }).catch(() => {})
  }
}

async function cmdStatus(interaction) {
  const projects = await fetch(`${apiBase}/projects`).then(r => r.json())
  const statusEmoji = { idle: '\u26AA', running: '\uD83D\uDFE2', paused: '\uD83D\uDFE1', done: '\uD83D\uDD35' }
  const embed = new EmbedBuilder()
    .setTitle('\uD83D\uDCCB Hangar Projects')
    .setColor(0x22c55e)
    .setTimestamp()
  let desc = ''
  for (const p of projects) {
    const emoji = statusEmoji[p.status] || '\u26AA'
    desc += `${emoji} **${p.name}** \`${p.status}\` ${p.harness || ''} · ${(p.model || '').slice(0, 30)}\n`
  }
  embed.setDescription(desc || 'No projects')
  await interaction.reply({ embeds: [embed] })
}

export function stopDiscordBot() {
  if (client) {
    client.destroy()
    client = null
    console.log('[discord] Bot stopped')
  }
}

export function getDiscordClient() { return client }

// Discord notifications (called from index.js)
export async function notifyDiscord(projectName, type, detail) {
  const auth = loadAuth()
  if (!auth?.discordEnabled || !auth?.discordBotToken || !client?.isReady()) return
  const channel = await client.channels.fetch(auth.discordChannelId).catch(() => null)
  if (!channel) return
  try {
    if (type === 'running') {
      const embed = new EmbedBuilder().setTitle(`\u25B6\uFE0F **${projectName}** started`).setColor(0x22c55e).setTimestamp()
      if (detail?.sessionId) embed.setURL(`http://localhost:${apiBase.split(':')[2]?.split('/')[0] || '3333'}/sessions/${detail.sessionId}`)
      await channel.send({ embeds: [embed] })
    } else if (type === 'idle' || type === 'done') {
      const embed = new EmbedBuilder().setTitle(`\u2705 **${projectName}** finished`).setColor(0x3b82f6).setTimestamp()
      await channel.send({ embeds: [embed] })
    } else if (type === 'diff') {
      const embed = new EmbedBuilder().setTitle(`\uD83D\uDCC4 **${projectName}** has a diff ready`).setColor(0xeab308)
      if (detail?.sessionId) embed.setURL(`http://localhost:${apiBase.split(':')[2]?.split('/')[0] || '3333'}/sessions/${detail.sessionId}`)
      await channel.send({ embeds: [embed] })
    }
  } catch (e) {
    console.error('[discord] Notification failed:', e.message)
  }
}

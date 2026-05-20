# ✈️ Hangar

> Orchestrate your AI coding agents from one place.

## ✨ Features

| | Feature | Description |
|---|---|---|
| 🗂️ | Kanban Board | Visual project management — Idle / Running / Paused / Done |
| 💬 | Live Terminal | Real PTY via xterm.js — full ANSI, persists across refreshes |
| 📋 | Artifact Review | Inline comments on agent plans and diffs, injected back as XML |
| 🌐 | Public URL | Cloudflare Tunnel with one flag + QR code for mobile access |
| 📡 | LAN Access | Works on home network out of the box, no config needed |
| 🔐 | Token Auth | Auto-generated token, required only for public URLs |
| 🤖 | Discord Bot | `/status` `/launch` `/stop` `/artifacts` — control agents from Discord |
| 📱 | WhatsApp Bot | Same commands via WhatsApp — zero API cost |

## ⚡ Quick Start

### Install

```bash
git clone https://github.com/gapigo/hangar
cd hangar
npm run setup
```

### Start (home network)

```bash
npm start
```

Open → http://localhost:3333
LAN  → http://192.168.x.x:3333  (printed on startup)

### Start with public URL (outside home / mobile)

```bash
npm run start:public
```

Prints a Cloudflare URL + QR code in the terminal. Scan with your phone.

## 📋 Artifact Review

When your agent produces a plan or diff, it appears in the **Artifacts panel**.
Click **+** on any line to comment. Click **Send Feedback** to inject your notes
back into the agent's stdin as structured XML — no copy-paste, no context switching.

Diffs are syntax-highlighted: green for additions, red for deletions, blue for headers.
Click **✓ Resolve** to dismiss individual comments.

## 🤖 Agent Support

| Agent | Support |
|---|---|
| oh-my-pi (omp) | ✅ Native |
| OpenCode | ✅ |
| Claude Code | ✅ |
| Aider | ✅ |
| Any PTY CLI | ✅ Generic |

## ⚙️ Settings

All config lives in `~/.hangar/`:

```
~/.hangar/
├── projects.json          # your projects
├── auth.json              # token + bot credentials
├── tunnel.json            # active tunnel URL
├── artifacts/             # persisted artifact history (.jsonl)
└── whatsapp-session/      # WhatsApp auth (auto)
```

Configure tunnel, Discord, and WhatsApp from the Settings page.

### 🤖 Discord Bot Setup

1. Create bot at https://discord.com/developers
2. Settings → Discord → paste token + channel ID → enable
3. Use `/status`, `/launch`, `/stop`, `/artifacts` from any channel

### 📱 WhatsApp Bot Setup

1. Settings → WhatsApp → enter phone number → enable
2. Scan the QR code that appears in Settings
3. Session persists automatically

## 🏗️ Architecture

```
Browser / Mobile PWA
      ↕ WebSocket + SSE
Node.js Backend (Express + node-pty)
      ↕
ArtifactParser ← PTY stream intercept
      ↓
Artifacts Panel → inline comments → XML feedback → PTY stdin
```

## 📦 Stack

- **Frontend**: React 19 · Vite · Tailwind v4 · shadcn/ui · TanStack Router · xterm.js
- **Backend**: Node.js · Express · ws · node-pty · SSE
- **Bots**: discord.js v14 · whatsapp-web.js
- **Tunnel**: cloudflared

## License

MIT

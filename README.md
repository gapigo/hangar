# Hangar

**Code agent workspace — launch, park, and monitor CLI coding agents from a visual dashboard.**

Hangar spawns real CLI processes (`omp`, `claude`, `codex`, `opencode`, `pi`) on your machine and streams their terminal output to the browser via WebSocket. It does not call any AI API directly — your agents run locally, with your own API keys.

![Hangar kanban](.github/kanban.png)

---

## Quick Start

```bash
git clone https://github.com/gapigo/hangar.git
cd hangar
npm run setup
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## Prerequisites

| Requirement | Why |
|-------------|-----|
| **Node.js ≥ 22** | Runtime for backend and build tooling |
| **npm** | Package manager (comes with Node) |
| **At least one CLI agent** | `omp`, `claude`, `codex`, `opencode`, or `pi` in your PATH |

### Windows extras

`node-pty` compiles native addons on install. If `npm run setup` fails with compilation errors:

```bash
# Install Windows build tools (admin terminal)
npm install -g windows-build-tools
# Then retry
npm run setup
```

### Bun (for `omp` harness)

The `omp` harness spawns the agent via Bun. Install it once:

```bash
# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"

# macOS / Linux
curl -fsSL https://bun.sh/install | bash
```

---

## Architecture

```
hangar/
├── start.js              # Dev launcher — starts backend + frontend together
├── cli.js                # Production entry point (backend only)
├── backend/
│   ├── index.js          # Express + WebSocket server (port 3333)
│   ├── session-manager.js # Spawns/kills agent processes via node-pty
│   ├── project-store.js  # JSON file persistence (~/.hangar/projects.json)
│   ├── harness-detector.js # Auto-detects installed CLIs in PATH
│   └── model-reader.js   # Reads models from ~/.omp/agent/models.yml
└── frontend/
    └── src/
        ├── features/
        │   ├── kanban/    # Drag-and-drop project board
        │   └── sessions/  # Live terminal (xterm.js) + active agents hub
        └── lib/           # API client, SSE hook, WebSocket hook
```

**Backend** (Express, port 3333):
- REST API for projects CRUD
- WebSocket server for live terminal streaming
- SSE endpoint for real-time status broadcasts
- Node-pty spawns real shell processes

**Frontend** (Vite + React, port 5173 in dev):
- Kanban board with drag-and-drop between Idle/Running/Paused/Done columns
- Live xterm.js terminal for each session
- Active agents hub with real-time updates
- Connects directly to backend via CORS (no proxy)

---

## Usage

### 1. Create a project

Click **New Project** in the top-right. Fill in:

| Field | Description |
|-------|-------------|
| Name | Any label (e.g. "My Agent") |
| Path | Working directory for the agent |
| Harness | Which CLI to use (`omp`, `claude`, etc.) |
| Model | Model ID loaded from your OMP config |

### 2. Launch an agent

Drag a card from the **Idle** column to the **Running** column. A modal opens where you can:

- Pick the harness and model
- Write an optional initial prompt
- Click **Launch**

The agent process starts immediately and you're taken to the terminal.

### 3. Terminal

The terminal view (at `/sessions/:id`) shows:

- **Left sidebar** — all your projects, click to switch sessions
- **Main area** — live xterm.js terminal with full ANSI color support
- Type directly into the terminal — input goes to the agent's stdin
- Resize the window — terminal dimensions sync to the PTY

### 4. Stop or move cards

- **Running → Idle**: Drag to Idle column (kills the process)
- **Running → Paused**: Agent exited with non-zero code
- **Running → Done**: Agent exited cleanly
- Drag cards freely between any columns

---

## API Endpoints

All available at `http://localhost:3333/api`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/harnesses` | List detected CLIs in PATH |
| `GET` | `/models` | List models from `~/.omp/agent/models.yml` |
| `GET` | `/projects` | List all projects |
| `POST` | `/projects` | Create a project |
| `PATCH` | `/projects/:id` | Update a project |
| `DELETE` | `/projects/:id` | Delete a project |
| `POST` | `/projects/:id/start` | Spawn agent process |
| `POST` | `/projects/:id/stop` | Kill agent process |
| `GET` | `/events` | SSE stream of status changes |

---

## Scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Starts backend (node --watch) + frontend (Vite dev server) |
| `npm run build` | Builds frontend to `frontend/dist/` |
| `npm start` | Production mode — backend only, serves built frontend from dist |
| `npm run setup` | `npm install` in both `backend/` and `frontend/` |

---

## Troubleshooting

**`npm run setup` fails on Windows**
→ Install `windows-build-tools` globally, then retry. `node-pty` needs native compilation.

**Browser shows blank page**
→ Make sure the backend is running on port 3333. The frontend connects to the backend directly — if the backend is down, the UI won't load data.

**Terminal shows no output**
→ The agent CLI must be in your PATH. Run `curl http://localhost:3333/api/harnesses` to verify detection. The `omp` harness requires Bun.

**Port 3333 or 5173 already in use**
→ Kill existing Node processes. On Windows: `taskkill /F /IM node.exe`.

---

## License

MIT

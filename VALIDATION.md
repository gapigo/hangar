# Hangar Validation Report

**Date:** 2026-05-16
**Environment:** Windows 11 Pro, Node.js v24.12.0

---

## URLs

- **Backend API:** http://localhost:3333
- **Frontend:** http://localhost:5173

---

## Phase 1 — Backend: Harness Detection

| Endpoint | Status | Output |
|----------|--------|--------|
| `GET /api/harnesses` | ✅ | 5 harnesses detected (omp, claude, codex, opencode, pi) — all available |

## Phase 2 — Backend: Model Reading

| Endpoint | Status | Output |
|----------|--------|--------|
| `GET /api/models` | ✅ | 15 models loaded from `~/.omp/agent/models.yml` (DeepSeek, Groq, Together, Fireworks, Ollama, Kimi) |

## Phase 3 — Projects CRUD

| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /api/projects` | ✅ | Returns all projects with harness field |
| `POST /api/projects` | ✅ | Creates with `{ name, path, model, harness }` |
| `PATCH /api/projects/:id` | ✅ | Updates any fields including harness/model |
| `DELETE /api/projects/:id` | ✅ | Stops process + removes from store |

## Phase 4 — Process Management

| Action | Status | Notes |
|--------|--------|-------|
| `POST /api/projects/:id/start` | ✅ | Accepts `{ prompt, harness, model }`, spawns process |
| `POST /api/projects/:id/stop` | ✅ | Kills process safely |
| SSE `/api/events` | ✅ | Broadcasts `{ type: 'status', id, status }` on process events |
| WebSocket `/sessions/:id` | ✅ | Streams output, accepts stdin input |

## Phase 5 — Frontend: KanbanView

| Feature | Status | Notes |
|---------|--------|-------|
| 4-column kanban (Idle, Running, Paused, Done) | ✅ | Shows all projects grouped by status |
| Drag-to-Running opens launch modal | ✅ | Select harness, model, optional prompt |
| SSE auto-update | ✅ | Status badges update without reload |
| Free drag between all columns | ✅ | Running→Paused stops process, Paused→Running reopens modal |
| New Project dialog | ✅ | Harness + model selects loaded from API |

## Phase 6 — Frontend: SessionView

| Feature | Status | Notes |
|---------|--------|-------|
| Terminal output (black bg, green text, monospace) | ✅ | ANSI color support via ansi-to-html |
| WebSocket real-time streaming | ✅ | Connects to `ws://localhost:3333/sessions/:id` |
| Input bar (Enter=send, Shift+Enter=newline) | ✅ | Disabled when agent not running |
| Project switcher sidebar | ✅ | Lists all projects with status badges |
| Process exit handling | ✅ | Shows exit code and status |

## Phase 7 — Frontend: Sessions Hub

| Feature | Status | Notes |
|---------|--------|-------|
| `/sessions` route | ✅ | Lists running/paused agents with SSE updates |
| Empty state | ✅ | "No agents running" with link back to Hangar |
| Terminal link | ✅ | "Open Terminal" button per card |

---

## Bugs Fixed

1. **TanStack Router duplicate `__root__`**: Removed intermediary layout route (`path: ''`), moved `AuthenticatedLayout` into root route component
2. **node-pty crash on Windows**: Replaced with `child_process.spawn` with `shell: true`
3. **Deprecation warning**: Passed command as single string instead of args array with `shell: true`
4. **Project store missing fields**: Added `harness` field support

## Files Changed

| File | Change |
|------|--------|
| `backend/harness-detector.js` | New — detects available CLIs |
| `backend/model-reader.js` | New — reads models from oh-my-pi config |
| `backend/session-manager.js` | Rewritten — child_process.spawn with broadcast, prompt injection |
| `backend/project-store.js` | Enhanced — supports harness field |
| `backend/index.js` | Rewritten — SSE, new endpoints, session manager events |
| `frontend/src/lib/api.ts` | Updated — harnesses, models, start with prompt |
| `frontend/src/lib/useSSE.ts` | New — EventSource hook |
| `frontend/src/lib/useWebSocket.ts` | Updated — new protocol |
| `frontend/src/features/kanban/index.tsx` | Rewritten — launch modal, SSE, free drag |
| `frontend/src/features/sessions/index.tsx` | Rewritten — terminal with ANSI |
| `frontend/src/features/sessions/hub.tsx` | New — active agents hub |
| `frontend/src/router.tsx` | Updated — added /sessions route |

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from '@tanstack/react-router'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Square, ArrowLeft, Play, Loader2 } from 'lucide-react'
import { useSSE } from '@/lib/useSSE'
import { cn } from '@/lib/utils'
import { api, type Project } from '@/lib/api'
import { ArtifactsPanel } from '@/features/sessions/ArtifactsPanel'
import { useIsMobile } from '@/hooks/use-mobile'
import '@xterm/xterm/css/xterm.css'

const statusColors: Record<string, string> = {
  idle: 'bg-muted text-muted-foreground',
  running: 'bg-emerald-500 text-white animate-pulse',
  paused: 'bg-yellow-500 text-black',
  done: 'bg-blue-500 text-white',
}

export function SessionView() {
  const { id } = useParams({ from: '/sessions/$id' })
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [exited, setExited] = useState(false)
  const [exitInfo, setExitInfo] = useState<{ exitCode: number; status: string } | null>(null)
  const [showArtifacts, setShowArtifacts] = useState(() => {
    try {
      return localStorage.getItem('hangar-show-artifacts-' + id) === 'true'
    } catch {
      return false
    }
  })
  const [pendingCount, setPendingCount] = useState(0)
  const [connecting, setConnecting] = useState(true)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const isMobile = useIsMobile()
  const mobileInputRef = useRef<HTMLInputElement>(null)
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  // Persist artifact panel toggle
  useEffect(() => {
    try { localStorage.setItem('hangar-show-artifacts-' + id, String(showArtifacts)) } catch {}
  }, [showArtifacts, id])

  // SSE: listen for status changes AND comment events
  useSSE(useCallback((data) => {
    if (data.type === 'comment-added' && data.projectId === id) setPendingCount(c => c + 1)
    if (data.type === 'status' && data.id === id) {
      setProject((prev) => prev ? { ...prev, status: data.status as Project['status'] } : prev)
      if (data.status === 'running') {
        setExited(false)
        setExitInfo(null)
        setConnecting(true)
        setStartError('')
        setStarting(false)
      }
    }
  }, [id]))

  const refresh = useCallback(() => {
    api.getProjects().then((data: Project[]) => {
      setProjects(data)
      const p = data.find((x) => x.id === id) || null
      if (p) setProject(p)
    })
  }, [id])

  useEffect(() => { refresh() }, [refresh])

  // xterm.js terminal setup
  useEffect(() => {
    if (!termRef.current || terminalRef.current) return

    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
      theme: {
        background: '#09090b',
        foreground: '#d4d4d8',
        cursor: '#22c55e',
        selectionBackground: '#22c55e33',
        black: '#18181b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#d4d4d8',
        brightBlack: '#71717a',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#fafafa',
      },
    })

    term.loadAddon(fitAddon)
    term.open(termRef.current)
    requestAnimationFrame(() => {
      fitAddon.fit()
      requestAnimationFrame(() => fitAddon.fit())
    })
    terminalRef.current = term

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/sessions/${id}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setConnecting(false)
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'data') {
          term.write(msg.data)
        } else if (msg.type === 'exit') {
          setExited(true)
          setExitInfo({ exitCode: msg.exitCode, status: msg.status })
          term.write(`\r\n\x1b[33m[Process exited with code ${msg.exitCode} \u2014 ${msg.status}]\x1b[0m\r\n`)
        } else if (msg.type === 'error') {
          setStartError(msg.message)
          term.write(`\r\n\x1b[31m[${msg.message}]\x1b[0m\r\n`)
        }
      } catch {
        term.write(event.data)
      }
    }

    ws.onclose = () => {
      setExited(true)
    }

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })

    const resizeObserver = new ResizeObserver(() => {
      if (!fitAddonRef.current) return
      fitAddonRef.current.fit()
      const dims = fitAddonRef.current.proposeDimensions()
      if (dims && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
      }
    })

    if (termRef.current) {
      resizeObserver.observe(termRef.current)
    }

    termRef.current.addEventListener('click', () => term.focus())

    return () => {
      resizeObserver.disconnect()
      term.dispose()
      terminalRef.current = null
      ws.close()
      wsRef.current = null
    }
  }, [id])

  const handleStop = async () => {
    await api.stopProject(id)
    setExited(true)
    refresh()
  }

  const handleStart = async () => {
    if (!project) return
    setStarting(true)
    setStartError('')
    setExited(false)
    setExitInfo(null)
    setConnecting(true)
    try {
      await api.startProject(id, {
        harness: project.harness || 'omp',
        model: project.model,
      })
      refresh()
    } catch (e) {
      setStartError(String(e))
      setStarting(false)
      setConnecting(false)
    }
  }

  const isRunning = project?.status === 'running' && !exited
  const canStart = project && !isRunning && project.status !== 'running'

  // Inject xterm layout fixes on mount
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `
      .xterm { height: 100%; width: 100%; padding: 0; }
      .xterm-viewport { width: 100% !important; }
      .xterm-screen { width: 100% !important; }
    `
    document.head.appendChild(style)
    return () => style.remove()
  }, [])

  return (
    <div className='flex h-full'>
      {/* Left sidebar - project switcher */}
      <div className='flex w-[240px] flex-col border-r bg-muted/30'>
        <div className='border-b p-3'>
          <h2 className='text-sm font-semibold'>Sessions</h2>
        </div>
        <ScrollArea className='flex-1'>
          <div className='flex flex-col gap-1 p-2'>
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate({ to: '/sessions/$id', params: { id: p.id } })}
                className={`flex flex-col items-start rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  p.id === id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                }`}
              >
                <span className='font-medium'>{p.name}</span>
                <div className='mt-1 flex flex-wrap gap-1'>
                  <Badge className={`text-[10px] ${statusColors[p.status]}`}>
                    {p.id === id && exitInfo ? exitInfo.status : p.status}
                  </Badge>
                  {p.harness && (
                    <Badge variant='outline' className='text-[9px]'>
                      {p.harness}
                    </Badge>
                  )}
                </div>
              </button>
            ))}
            {projects.length === 0 && (
              <div className='px-3 py-4 text-xs text-muted-foreground'>No projects yet.</div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Main terminal area */}
      <div className='flex flex-1 flex-col'>
        {/* Header */}
        <div className='flex items-center justify-between border-b bg-muted/20 px-4 py-2'>
          <div className='flex items-center gap-3'>
            <Link to='/' className='text-muted-foreground hover:text-foreground'>
              <ArrowLeft className='h-4 w-4' />
            </Link>
            <h1 className='text-sm font-semibold'>{project?.name || 'Session'}</h1>
            {project?.harness && (
              <Badge variant='outline' className='text-[10px]'>
                {project.harness}
              </Badge>
            )}
            {project?.model && (
              <Badge variant='secondary' className='text-[10px]'>
                {project.model}
              </Badge>
            )}
            <Badge className={`text-[10px] ${statusColors[project?.status || 'idle']}`}>
              {exitInfo ? exitInfo.status : project?.status || 'idle'}
            </Badge>
          </div>
          <div className='flex items-center gap-2'>
            <Button
              variant={showArtifacts ? 'default' : 'outline'}
              size='sm'
              onClick={() => setShowArtifacts(v => !v)}
            >
              Artifacts
              {pendingCount > 0 && (
                <Badge className='ml-1 bg-yellow-400 text-black'>{pendingCount}</Badge>
              )}
            </Button>
            {isRunning && (
              <Button size='sm' variant='destructive' onClick={handleStop}>
                <Square className='mr-1 h-3 w-3' /> Stop
              </Button>
            )}
            {canStart && (
              <Button size='sm' onClick={handleStart} disabled={starting}>
                {starting ? (
                  <Loader2 className='mr-1 h-3 w-3 animate-spin' />
                ) : (
                  <Play className='mr-1 h-3 w-3' />
                )}
                {starting ? 'Starting...' : 'Start'}
              </Button>
            )}
          </div>
        </div>

        {/* Connecting overlay */}
        {connecting && isRunning && (
          <div className='flex items-center justify-center gap-2 py-2 bg-emerald-500/10 border-b border-emerald-500/20 text-xs text-emerald-400'>
            <Loader2 className='h-3 w-3 animate-spin' />
            Connecting to session...
          </div>
        )}

        {/* Start error */}
        {startError && (
          <div className='flex items-center justify-center gap-2 py-2 bg-destructive/10 border-b border-destructive/20 text-xs text-destructive'>
            {startError}
            <Button size='sm' variant='outline' className='h-6 text-[10px]' onClick={handleStart}>
              Retry
            </Button>
          </div>
        )}

        {/* Split container */}
        {isMobile ? (
          <Tabs defaultValue="terminal" className="flex flex-col flex-1 overflow-hidden">
            <TabsList className="mx-2 mt-1 shrink-0">
              <TabsTrigger value="terminal" className="flex-1">Terminal</TabsTrigger>
              <TabsTrigger value="artifacts" className="flex-1">
                Artifacts
                {pendingCount > 0 && (
                  <Badge className="ml-1 bg-yellow-400 text-black text-[10px]">{pendingCount}</Badge>
                )}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="terminal" className="flex-1 overflow-hidden m-0">
              <input
                ref={mobileInputRef}
                className="opacity-0 absolute w-0 h-0"
                onInput={(e) => {
                  const val = (e.target as HTMLInputElement).value
                  if (val && wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(val)
                    ;(e.target as HTMLInputElement).value = ''
                  }
                }}
                onKeyDown={(e) => {
                  if (wsRef.current?.readyState !== WebSocket.OPEN) return
                  if (e.key === 'Enter') wsRef.current.send('\r')
                  if (e.key === 'Backspace') wsRef.current.send('\x7f')
                }}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <div
                ref={termRef}
                className="flex-1 min-h-0 relative"
                style={{ padding: '4px', background: '#09090b' }}
                onClick={() => mobileInputRef.current?.focus()}
              />
            </TabsContent>
            <TabsContent value="artifacts" className="flex-1 overflow-y-auto m-0">
              <ArtifactsPanel projectId={id} />
            </TabsContent>
          </Tabs>
        ) : (
          <>
            <div className={cn(
              'flex-1 min-w-0 flex flex-col',
              showArtifacts && 'w-1/2 flex-none'
            )}>
              <div
                ref={termRef}
                className="flex-1 min-h-0 relative"
                style={{ padding: '4px', background: '#09090b' }}
              />
            </div>
            {showArtifacts && (
              <div className="overflow-y-auto border-l border-border w-1/2">
                <ArtifactsPanel projectId={id} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

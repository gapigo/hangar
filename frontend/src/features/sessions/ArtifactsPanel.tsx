import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { useSSE } from '@/lib/useSSE'
import { api } from '@/lib/api'
import { toast } from 'sonner'

type Comment = {
  id: string
  lineIndex: number
  text: string
  createdAt: string
  resolved: boolean
}

type Artifact = {
  id: string
  type: 'thinking' | 'plan' | 'tool_use' | 'diff' | 'message'
  title: string
  lines: string[]
  createdAt: number
  comments: Record<number, Comment[]>
}

function timeAgo(ts: number) {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}min ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ago`
}

function countPending(artifacts: Artifact[]) {
  let count = 0
  for (const a of artifacts) {
    for (const comments of Object.values(a.comments)) {
      count += comments.filter((c) => !c.resolved).length
    }
  }
  return count
}

function LineWithComment({
  line,
  lineIndex,
  artifactId,
  projectId,
  comments,
}: {
  line: string
  lineIndex: number
  artifactId: string
  projectId: string
  comments?: Comment[]
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const hasPending = comments?.some((c) => !c.resolved)

  const submit = async () => {
    if (!text.trim()) return
    await api.addComment(projectId, artifactId, lineIndex, text)
    setOpen(false)
    setText('')
  }

  const pendingCount = comments?.filter((c) => !c.resolved).length || 0

  return (
    <div
      className={cn(
        'group flex gap-1 items-start font-mono text-xs px-2 py-0.5 hover:bg-muted/40 relative',
        hasPending && 'border-l-2 border-yellow-400 bg-yellow-50/5'
      )}
    >
      <button
        onClick={() => setOpen(!open)}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary shrink-0 mt-0.5"
        aria-label="Add comment on this line"
      >
        +
      </button>
      <span className="whitespace-pre-wrap break-all flex-1">{line || ' '}</span>
      {pendingCount > 0 && (
        <span className="text-yellow-400 text-[10px] shrink-0">
          {'\uD83D\uDCAC'}
          {pendingCount}
        </span>
      )}
      {hasPending &&
        comments
          ?.filter((c) => !c.resolved)
          .map((c) => (
            <span
              key={c.id}
              className="text-[10px] text-yellow-600 shrink-0"
              title={c.text}
            >
              {'\uD83D\uDCAC'}
            </span>
          ))}
      {open && (
        <div className="absolute left-6 top-full z-50 mt-1 w-64 bg-popover border rounded shadow-lg p-2 flex flex-col gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Your comment..."
            rows={2}
            autoFocus
          />
          <div className="flex gap-1 justify-end">
            <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit}>
              Comment
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function ArtifactsPanel({ projectId }: { projectId: string }) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [openSections, setOpenSections] = useState<Set<string>>(new Set())

  const pendingCount = countPending(artifacts)

  // SSE: listen for artifact events
  useSSE(
    useCallback(
      (data) => {
        if (data.projectId !== projectId) return
        if (data.type === 'artifact') {
          const a = data.artifact as Artifact
          setArtifacts((prev) => {
            // Avoid duplicates
            if (prev.some((x) => x.id === a.id)) return prev
            return [...prev, a]
          })
        } else if (data.type === 'artifact-update') {
          const a = data.artifact as Artifact
          setArtifacts((prev) =>
            prev.map((x) => (x.id === a.id ? a : x))
          )
        } else if (data.type === 'comment-added') {
          const artifactId = (data as Record<string, unknown>).artifactId as string
          const comment = (data as Record<string, unknown>).comment as Comment
          setArtifacts((prev) =>
            prev.map((x) => {
              if (x.id !== artifactId) return x
              const lineComments = { ...x.comments }
              if (!lineComments[comment.lineIndex])
                lineComments[comment.lineIndex] = []
              lineComments[comment.lineIndex] = [
                ...(lineComments[comment.lineIndex] || []),
                comment,
              ]
              return { ...x, comments: lineComments }
            })
          )
        }
      },
      [projectId]
    )
  )

  // Initial fetch
  useEffect(() => {
    api.getArtifacts(projectId).then((data) => {
      if (Array.isArray(data)) setArtifacts(data)
    })
  }, [projectId])

  const toggleSection = (artifactId: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(artifactId)) next.delete(artifactId)
      else next.add(artifactId)
      return next
    })
  }

  const handleSendFeedback = async () => {
    const result = await api.sendFeedback(projectId)
    if (result.injected) {
      toast.success('Feedback injected into agent session')
      // Reload artifacts to reflect resolved comments
      api.getArtifacts(projectId).then((data) => {
        if (Array.isArray(data)) setArtifacts(data)
      })
    } else {
      toast.info(result.message || 'No pending comments')
    }
  }

  const typeIcons: Record<string, string> = {
    thinking: '\uD83E\uDDE0',
    plan: '\uD83D\uDCCB',
    tool_use: '\uD83D\uDD27',
    diff: '\uD83D\uDCC4',
    message: '\uD83D\uDCAC',
  }

  return (
    <div className="flex flex-col h-full border-l bg-muted/10">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{'\uD83D\uDCCB'} Artifacts</span>
          {pendingCount > 0 && (
            <Badge className="bg-yellow-400 text-black text-[10px]">
              {pendingCount} pending
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleSendFeedback}
          disabled={pendingCount === 0}
        >
          Send Feedback
        </Button>
      </div>

      {/* Artifact list */}
      <ScrollArea className="flex-1">
        {artifacts.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No artifacts yet. Start a session to see agent output parsed here.
          </div>
        )}
        <div className="flex flex-col">
          {artifacts.map((artifact) => {
            const isOpen = openSections.has(artifact.id)
            const artPending = Object.values(artifact.comments).reduce(
              (sum, cs) => sum + cs.filter((c) => !c.resolved).length,
              0
            )
            return (
              <Collapsible
                key={artifact.id}
                open={isOpen}
                onOpenChange={() => toggleSection(artifact.id)}
              >
                <CollapsibleTrigger className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/30 w-full text-left border-b border-border/40">
                  <span className="text-muted-foreground">
                    {isOpen ? '\u25BC' : '\u25B6'}
                  </span>
                  <span>{typeIcons[artifact.type] || '\uD83D\uDCAC'}</span>
                  <span className="font-medium truncate">{artifact.title}</span>
                  {artPending > 0 && (
                    <Badge className="ml-auto bg-yellow-400 text-black text-[9px]">
                      {'\uD83D\uDCAC'}
                      {artPending}
                    </Badge>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {timeAgo(artifact.createdAt)}
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-b border-border/30 bg-muted/5">
                    {artifact.lines.map((line, i) => (
                      <LineWithComment
                        key={i}
                        line={line}
                        lineIndex={i}
                        artifactId={artifact.id}
                        projectId={projectId}
                        comments={
                          artifact.comments[i]
                            ? [...artifact.comments[i]]
                            : undefined
                        }
                      />
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}

export { countPending }

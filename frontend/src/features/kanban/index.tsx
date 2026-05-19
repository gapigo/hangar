import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Plus, MoreHorizontal } from 'lucide-react'
import { api, type Project, type Harness, type ModelInfo } from '@/lib/api'
import { useSSE } from '@/lib/useSSE'

const COLUMNS = [
  { id: 'idle', label: 'Idle', color: 'bg-muted' },
  { id: 'running', label: 'Running', color: 'bg-emerald-500/10' },
  { id: 'paused', label: 'Paused', color: 'bg-yellow-500/10' },
  { id: 'done', label: 'Done', color: 'bg-blue-500/10' },
] as const

const COLUMN_IDS = COLUMNS.map((c) => c.id)

const statusColors: Record<string, string> = {
  idle: 'bg-muted text-muted-foreground',
  running: 'bg-emerald-500 text-white animate-pulse',
  paused: 'bg-yellow-500 text-black',
  done: 'bg-blue-500 text-white',
}

export function KanbanView() {
  const [projects, setProjects] = useState<Project[]>([])
  const [open, setOpen] = useState(false)
  const [newProject, setNewProject] = useState({ name: '', path: '', model: '', harness: 'omp' })
  const [activeId, setActiveId] = useState<string | null>(null)
  const [launchProject, setLaunchProject] = useState<Project | null>(null)
  const [launchPrompt, setLaunchPrompt] = useState('')
  const [launchHarness, setLaunchHarness] = useState('omp')
  const [launchModel, setLaunchModel] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<Project | null>(null)
  const [harnesses, setHarnesses] = useState<Harness[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const navigate = useNavigate()
  const [homeDir, setHomeDir] = useState('')
  const [settingsDefaultPath, setSettingsDefaultPath] = useState('')

  const refresh = useCallback(() => {
    api.getProjects().then(setProjects).catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    api.getHarnesses().then(setHarnesses).catch(() => {
      setHarnesses([
        { id: 'omp', name: 'Oh-My-Pi', command: 'omp', available: true },
        { id: 'claude', name: 'Claude Code', command: 'claude', available: true },
        { id: 'codex', name: 'Codex', command: 'codex', available: true },
      ])
    })
    api.getModels().then(setModels).catch(() => {
      setModels([
        { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
        { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      ])
    })
  }, [refresh])

  // Load config and saved settings
  useEffect(() => {
    fetch('http://localhost:3333/api/config')
      .then((r) => r.json())
      .then((c) => setHomeDir(c.homeDir || ''))
      .catch(() => {})

    try {
      const saved = JSON.parse(localStorage.getItem('hangar-settings') || '{}')
      if (saved.defaultPath) setSettingsDefaultPath(saved.defaultPath)
    } catch {}
  }, [])

  // SSE auto-update for status changes
  useSSE(
    useCallback((data) => {
      if (data.type === 'status') {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === data.id ? { ...p, status: data.status as Project['status'] } : p
          )
        )
      }
    }, [])
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: import('@dnd-kit/core').DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    if (!over) return

    const activeIdStr = active.id as string
    const overIdStr = over.id as string
    const project = projects.find((p) => p.id === activeIdStr)
    if (!project) return

    const targetCol = COLUMN_IDS.includes(overIdStr as (typeof COLUMN_IDS)[number])
      ? overIdStr
      : projects.find((p) => p.id === overIdStr)?.status

    if (!targetCol || targetCol === project.status) return

    const go = (to: Project['status']) => {
      if (to === project.status) return
      api.updateProject(activeIdStr, { status: to }).then(() => refresh())
    }

    // Idle → Running: open launch modal
    if (project.status === 'idle' && targetCol === 'running') {
      setLaunchProject(project)
      setLaunchPrompt(project.lastPrompt || '')
      setLaunchHarness(project.lastHarness || project.harness || 'omp')
      setLaunchModel(project.lastModel || project.model || '')
      return
    }

    // Running → Paused: stop + pause
    if (project.status === 'running' && targetCol === 'paused') {
      api.stopProject(activeIdStr).then(() => go('paused'))
      return
    }

    // Running → Done: stop + done
    if (project.status === 'running' && targetCol === 'done') {
      api.stopProject(activeIdStr).then(() => go('done'))
      return
    }

    // Paused → Idle
    if (project.status === 'paused' && targetCol === 'idle') {
      go('idle')
      return
    }

    // Paused → Running: open launch modal
    if (project.status === 'paused' && targetCol === 'running') {
      setLaunchProject(project)
      setLaunchPrompt(project.lastPrompt || '')
      setLaunchHarness(project.lastHarness || project.harness || 'omp')
      setLaunchModel(project.lastModel || project.model || '')
      return
    }

    // Done → Idle
    if (project.status === 'done' && targetCol === 'idle') {
      go('idle')
      return
    }

    // Default: just update status
    go(targetCol as Project['status'])
  }

  const doLaunch = () => {
    if (!launchProject) return
    api
      .updateProject(launchProject.id, { harness: launchHarness, model: launchModel })
      .then(() => {
        api
          .startProject(launchProject.id, {
            prompt: launchPrompt || undefined,
            harness: launchHarness,
            model: launchModel,
          })
          .then(() => {
            refresh()
            navigate({ to: '/sessions/$id', params: { id: launchProject.id } })
          })
      })
    setLaunchProject(null)
  }

  const createProject = () => {
    if (!newProject.name || !newProject.path) return
    api.createProject({ ...newProject, harness: newProject.harness }).then(() => {
      setOpen(false)
      setNewProject({ name: '', path: '', model: '', harness: 'omp' })
      refresh()
    })
  }

  const handleArchive = async (project: Project) => {
    await api.archiveProject(project.id)
    refresh()
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    await api.deleteProject(deleteConfirm.id)
    setDeleteConfirm(null)
    refresh()
  }

  const availableHarnesses = useMemo(() => harnesses.filter((h) => h.available), [harnesses])
  const availableModels = useMemo(() => {
    if (!launchHarness || launchHarness === 'omp') return models
    return models.filter((m) => !m.harness || m.harness === launchHarness)
  }, [models, launchHarness])

  return (
    <div className='flex h-full flex-col gap-4 p-4'>
      <div className='flex items-center justify-between'>
        <h1 className='text-2xl font-bold tracking-tight'>Hangar</h1>
        <Button
          size='sm'
          onClick={() => {
            const defaultPath = settingsDefaultPath || homeDir
            setNewProject(p => ({ ...p, path: defaultPath }))
            setOpen(true)
          }}
        >
          <Plus className='mr-1 h-4 w-4' />
          New Project
        </Button>
      </div>

      {/* New project dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
            <DialogDescription>Create a new agent workspace.</DialogDescription>
          </DialogHeader>
          <div className='grid gap-4 py-4'>
            <div className='grid gap-2'>
              <Label htmlFor='name'>Name</Label>
              <Input
                id='name'
                value={newProject.name}
                onChange={(e) => setNewProject((p) => ({ ...p, name: e.target.value }))}
                placeholder='My Agent Project'
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='path'>Path</Label>
              <Input
                id='path'
                value={newProject.path}
                onChange={(e) => setNewProject((p) => ({ ...p, path: e.target.value }))}
                placeholder={homeDir || 'Project folder path'}
              />
            </div>
            <div className='grid gap-2'>
              <Label>Harness</Label>
              <Select
                value={newProject.harness}
                onValueChange={(v) => setNewProject((p) => ({ ...p, harness: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableHarnesses.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-2'>
              <Label>Model</Label>
              <Select
                value={newProject.model}
                onValueChange={(v) => setNewProject((p) => ({ ...p, model: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder='Select a model' />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createProject}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

		{/* Launch modal */}
		<Dialog open={!!launchProject} onOpenChange={() => setLaunchProject(null)}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Launch {launchProject?.name}</DialogTitle>
					<DialogDescription>
						{launchProject?.harness && launchProject?.model
							? `${launchProject.harness} · ${launchProject.model}`
							: 'Configure harness, model, and optional initial prompt.'}
					</DialogDescription>
				</DialogHeader>
				<div className='grid gap-4 py-4'>
					{(!launchProject?.harness || !launchProject?.model) && (
						<>
							<div className='grid gap-2'>
								<Label>Harness</Label>
								<Select value={launchHarness} onValueChange={setLaunchHarness}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{availableHarnesses.map((h) => (
											<SelectItem key={h.id} value={h.id}>
												{h.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className='grid gap-2'>
								<Label>Model</Label>
								<Select value={launchModel} onValueChange={setLaunchModel}>
									<SelectTrigger>
										<SelectValue placeholder='Select a model' />
									</SelectTrigger>
									<SelectContent>
										{availableModels.map((m) => (
											<SelectItem key={m.id} value={m.id}>
												{m.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</>
					)}
					<div className='grid gap-2'>
						<Label>Initial Prompt (optional)</Label>
						<Textarea
							value={launchPrompt}
							onChange={(e) => setLaunchPrompt(e.target.value)}
							placeholder='What should the agent do?'
							className='min-h-[80px]'
						/>
					</div>
				</div>
				<DialogFooter>
					<Button variant='outline' onClick={() => setLaunchProject(null)}>
						Cancel
					</Button>
					<Button onClick={doLaunch} className='w-full'>
						▶ Launch
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Move "{deleteConfirm?.name}" to trash? It will be permanently deleted after 3 days.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className='bg-destructive text-destructive-foreground'>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(e) => setActiveId(e.active.id as string)}
        onDragEnd={handleDragEnd}
      >
        <div className='grid flex-1 grid-cols-4 gap-4 min-w-0 overflow-hidden'>
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              col={col}
              projects={projects.filter((p) => p.status === col.id)}
              onArchive={handleArchive}
              onDelete={(p) => setDeleteConfirm(p)}
              activeId={activeId}
            />
          ))}
        </div>
        <DragOverlay>
          {activeId ? (
            <ProjectCard
              project={projects.find((p) => p.id === activeId)!}
              onArchive={() => {}}
              onDelete={() => {}}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

function KanbanColumn({
  col,
  projects,
  onArchive,
  onDelete,
  activeId,
}: {
  col: (typeof COLUMNS)[number]
  projects: Project[]
  onArchive: (p: Project) => void
  onDelete: (p: Project) => void
  activeId: string | null
}) {
  const { setNodeRef } = useSortable({ id: col.id, data: { type: 'column', columnId: col.id } })

  return (
    <div ref={setNodeRef} className='flex flex-col gap-2 min-w-0 w-full overflow-hidden'>
      <div className='flex items-center gap-2 px-1'>
        <div
          className={`h-2 w-2 rounded-full ${
            col.id === 'running'
              ? 'bg-emerald-500 animate-pulse'
              : col.id === 'paused'
                ? 'bg-yellow-500'
                : col.id === 'done'
                  ? 'bg-blue-500'
                  : 'bg-muted-foreground'
          }`}
        />
        <span className='text-sm font-semibold'>{col.label}</span>
        <Badge variant='secondary' className='ml-auto text-xs'>
          {projects.length}
        </Badge>
      </div>
      <ScrollArea className='flex-1 rounded-lg border bg-muted/30 p-2'>
        <SortableContext items={projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          <div className='flex flex-col gap-2'>
            {projects.map((project) => (
              <SortableProjectCard
                key={project.id}
                project={project}
                onArchive={onArchive}
                onDelete={onDelete}
                isOverlay={activeId === project.id}
              />
            ))}
          </div>
        </SortableContext>
      </ScrollArea>
    </div>
  )
}

function SortableProjectCard({
  project,
  onArchive,
  onDelete,
  isOverlay,
}: {
  project: Project
  onArchive: (p: Project) => void
  onDelete: (p: Project) => void
  isOverlay?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: project.id,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <ProjectCard
        project={project}
        onArchive={onArchive}
        onDelete={onDelete}
        className={isOverlay ? 'opacity-80 shadow-lg' : ''}
      />
    </div>
  )
}

function ProjectCard({
  project,
  onArchive,
  onDelete,
  className,
}: {
  project: Project
  onArchive: (p: Project) => void
  onDelete: (p: Project) => void
  className?: string
}) {
  const navigate = useNavigate()

  return (
    <Card className={`cursor-grab active:cursor-grabbing overflow-hidden w-full ${className || ''}`}>
      <CardHeader className='pb-2 overflow-hidden'>
        <div className='flex items-start justify-between gap-2'>
          <div className='min-w-0 flex-1 overflow-hidden'>
            <h3 className='truncate max-w-full text-sm font-bold'>{project.name}</h3>
            <p className='mt-0.5 truncate max-w-full text-xs text-muted-foreground'>
              {project.path}
            </p>
          </div>
          <div className='flex items-start gap-1 overflow-hidden min-w-0'>
            <div className='flex flex-col items-end gap-0.5 overflow-hidden min-w-0'>
              {project.harness && (
                <Badge variant='outline' className='max-w-full truncate text-[9px]'>
                  {project.harness}
                </Badge>
              )}
              <Badge variant='secondary' className='max-w-full truncate text-[10px]'>
                {project.model}
              </Badge>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  className='h-6 w-6 shrink-0'
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className='h-3.5 w-3.5' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate({ to: '/sessions/$id', params: { id: project.id } })
                  }}
                >
                  Open Session
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    onArchive(project)
                  }}
                >
                  Archive
                </DropdownMenuItem>
                <DropdownMenuItem
                  className='text-destructive'
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(project)
                  }}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent className='space-y-2 pb-3 pt-0'>
        <Badge className={`text-[10px] ${statusColors[project.status]}`}>
          {project.status}
        </Badge>
        <div className='rounded bg-black/10 px-2 py-1 font-mono text-[10px] leading-tight text-muted-foreground'>
          {project.lastPrompt ? (
            <div className='truncate max-w-full'>{project.lastPrompt.slice(0, 80)}</div>
          ) : (
            <span className='opacity-50'>No prompt history</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

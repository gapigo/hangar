import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { api, type Project } from '@/lib/api'
import { useSSE } from '@/lib/useSSE'
import { ExternalLink, Activity } from 'lucide-react'

const statusColors: Record<string, string> = {
  idle: 'bg-muted',
  running: 'bg-emerald-500 text-white',
  paused: 'bg-yellow-500 text-black',
  done: 'bg-blue-500 text-white',
}

export function SessionsHub() {
  const [projects, setProjects] = useState<Project[]>([])
  const [allProjects, setAllProjects] = useState<Project[]>([])
  const navigate = useNavigate()

  const refresh = useCallback(() => {
    api.getProjects().then(setAllProjects).catch(() => {})
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    setProjects(allProjects.filter((p) => p.status === 'running' || p.status === 'paused'))
  }, [allProjects])

  useSSE(
    useCallback((data) => {
      if (data.type === 'status') {
        setAllProjects((prev) =>
          prev.map((p) =>
            p.id === data.id ? { ...p, status: data.status as Project['status'] } : p
          )
        )
      }
    }, [])
  )

  return (
    <div className='flex h-full flex-col gap-4 p-4'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          <Activity className='h-5 w-5 text-muted-foreground' />
          <h1 className='text-2xl font-bold tracking-tight'>Active Agents</h1>
          <Badge variant='secondary'>{projects.length}</Badge>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className='flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground'>
          <Activity className='h-12 w-12' />
          <p className='text-lg'>No agents running.</p>
          <p className='text-sm'>Go to Hangar to launch one.</p>
          <Button variant='outline' onClick={() => navigate({ to: '/' })}>
            Back to Hangar
          </Button>
        </div>
      ) : (
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {projects.map((p) => (
            <Card
              key={p.id}
              className='cursor-pointer transition-shadow hover:shadow-md'
              onClick={() => navigate({ to: '/sessions/$id', params: { id: p.id } })}
            >
              <CardHeader className='pb-2'>
                <div className='flex items-start justify-between'>
                  <div>
                    <h3 className='font-semibold'>{p.name}</h3>
                    <p className='text-xs text-muted-foreground'>
                      {p.harness && `${p.harness} · `}
                      {p.model}
                    </p>
                  </div>
                  <Badge className={`text-[10px] ${statusColors[p.status]}`}>
                    {p.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className='space-y-2 pb-3 pt-0'>
                <div className='rounded bg-black/10 px-2 py-1 font-mono text-[11px] text-muted-foreground'>
                  {p.path}
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  className='w-full'
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate({ to: '/sessions/$id', params: { id: p.id } })
                  }}
                >
                  <ExternalLink className='mr-1 h-3 w-3' /> Open Terminal
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

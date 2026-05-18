import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { api, type Harness, type ModelInfo, type Project } from '@/lib/api'

export function SettingsView() {
  const [defaultHarness, setDefaultHarness] = useState('omp')
  const [defaultModel, setDefaultModel] = useState('')
  const [port, setPort] = useState('3333')
  const [harnesses, setHarnesses] = useState<Harness[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [archive, setArchive] = useState<Project[]>([])
  const [defaultPath, setDefaultPath] = useState('')
  const [homeDir, setHomeDir] = useState('')

  // Load config (home directory) for default path
  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(c => {
        setHomeDir(c.homeDir || '')
      })
      .catch(() => {})
  }, [])
  // Load harnesses and models
  useEffect(() => {
    api.getHarnesses().then(setHarnesses).catch(() => {})
    api.getModels().then(setModels).catch(() => {})
    api.getArchive().then(setArchive).catch(() => {})
  }, [])

  // Load saved settings from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('hangar-settings')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (parsed.defaultHarness) setDefaultHarness(parsed.defaultHarness)
        if (parsed.defaultModel) setDefaultModel(parsed.defaultModel)
        if (parsed.port) setPort(String(parsed.port))
        if (parsed.defaultPath) setDefaultPath(parsed.defaultPath)
      } catch {
        // ignore
      }
    }
  }, [])

  const save = () => {
    localStorage.setItem(
      'hangar-settings',
      JSON.stringify({ defaultHarness, defaultModel, port: Number(port), defaultPath })
    )
  }

  const availableHarnesses = harnesses.filter((h) => h.available)

  return (
    <div className='mx-auto max-w-2xl space-y-6 p-6'>
      <h1 className='text-2xl font-bold tracking-tight'>Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Defaults</CardTitle>
          <CardDescription>
            Configure your Hangar workspace defaults. These are saved locally.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-2'>
            <Label htmlFor='harness'>Default Harness</Label>
            <Select value={defaultHarness} onValueChange={setDefaultHarness}>
              <SelectTrigger id='harness'>
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
            <Label htmlFor='model'>Default Model</Label>
            <Select value={defaultModel} onValueChange={setDefaultModel}>
              <SelectTrigger id='model'>
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

          <div className='grid gap-2'>
            <Label htmlFor='port'>Backend Port</Label>
            <Input
              id='port'
              type='number'
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='defaultPath'>Default Projects Path</Label>
            <Input
              id='defaultPath'
              value={defaultPath}
              onChange={(e) => setDefaultPath(e.target.value)}
              placeholder={homeDir || 'e.g. ~/workspace'}
            />
            <p className='text-xs text-muted-foreground'>
              Use <code>~</code> for your home directory. This will be pre-filled when creating new projects.
            </p>
          </div>

          <Button onClick={save}>Save</Button>
        </CardContent>
      </Card>

      {/* Archive section */}
      <Card>
        <CardHeader>
          <CardTitle>Archive</CardTitle>
          <CardDescription>
            Archived projects ({archive.length})
          </CardDescription>
        </CardHeader>
        <CardContent>
          {archive.length === 0 ? (
            <p className='text-sm text-muted-foreground'>No archived projects.</p>
          ) : (
            <ScrollArea className='max-h-[300px]'>
              <div className='space-y-2'>
                {archive.map((p) => (
                  <div
                    key={p.id}
                    className='flex items-center justify-between rounded-md border bg-muted/30 px-4 py-3'
                  >
                    <div>
                      <p className='text-sm font-medium'>{p.name}</p>
                      <p className='text-xs text-muted-foreground'>
                        {p.harness} · {p.model} · {p.path}
                      </p>
                      {p.archivedAt && (
                        <p className='text-[10px] text-muted-foreground'>
                          Archived: {new Date(p.archivedAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <Badge variant='outline' className='text-[9px]'>
                      {p.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

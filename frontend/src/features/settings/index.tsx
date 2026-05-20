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
import { Switch } from '@/components/ui/switch'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { toast } from 'sonner'
import { api, type Harness, type ModelInfo, type Project } from '@/lib/api'
import { useSSE } from '@/lib/useSSE'

function Hint({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; children: React.ReactNode }) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground pt-2 w-full text-left">
        <span className="text-base">{open ? '\u25BC' : '\u25B6'}</span> {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 space-y-1.5 text-xs text-muted-foreground border-t mt-2 ml-5 pl-3 border-l-2 border-l-muted">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function SettingsView() {
  const [defaultHarness, setDefaultHarness] = useState('omp')
  const [defaultModel, setDefaultModel] = useState('')
  const [port, setPort] = useState('3333')
  const [harnesses, setHarnesses] = useState<Harness[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [archive, setArchive] = useState<Project[]>([])
  const [defaultPath, setDefaultPath] = useState('')
  const [homeDir, setHomeDir] = useState('')
  const [lanIP, setLanIP] = useState('')

  const [token, setToken] = useState('')
  const [tunnelUrl, setTunnelUrl] = useState('')
  const [tunnelActive, setTunnelActive] = useState(false)

  const [discordToken, setDiscordToken] = useState('')
  const [discordChannelId, setDiscordChannelId] = useState('')
  const [discordEnabled, setDiscordEnabled] = useState(false)

  const [whatsappEnabled, setWhatsappEnabled] = useState(false)
  const [whatsappPhone, setWhatsappPhone] = useState('')
  const [whatsappQR, setWhatsappQR] = useState('')
  const [whatsappStatus, setWhatsappStatus] = useState('disconnected')

  const [hintTunnel, setHintTunnel] = useState(false)
  const [hintDiscord, setHintDiscord] = useState(false)
  const [hintWhatsApp, setHintWhatsApp] = useState(false)

  useEffect(() => {
    fetch(`http://localhost:${import.meta.env.VITE_API_PORT || '3333'}/api/config`)
      .then(r => r.json())
      .then(c => {
        setHomeDir(c.homeDir || '')
        setLanIP(c.lanIP || '')
        if (!defaultPath) setDefaultPath(c.homeDir || '')
      })
      .catch(() => {})
    api.getHarnesses().then(setHarnesses).catch(() => {})
    api.getModels().then(setModels).catch(() => {})
    api.getArchive().then(setArchive).catch(() => {})
    api.getAuthToken().then(d => setToken(d.token || '')).catch(() => {})
    api.getTunnel().then(d => {
      if (d.active) { setTunnelUrl(d.publicUrl || ''); setTunnelActive(true) }
    }).catch(() => {})
    fetch(`http://localhost:${import.meta.env.VITE_API_PORT || '3333'}/api/whatsapp/status`)
      .then(r => r.json()).then(d => setWhatsappStatus(d.connected ? 'online' : 'disconnected')).catch(() => {})
    fetch(`http://localhost:${import.meta.env.VITE_API_PORT || '3333'}/api/whatsapp/qr`)
      .then(r => r.json()).then(d => { if (d.qr) setWhatsappQR(d.qr) }).catch(() => {})
  }, [])

  useSSE(() => {})

  useEffect(() => {
    const saved = localStorage.getItem('hangar-settings')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (parsed.defaultHarness) setDefaultHarness(parsed.defaultHarness)
        if (parsed.defaultModel) setDefaultModel(parsed.defaultModel)
        if (parsed.port) setPort(String(parsed.port))
        if (parsed.defaultPath) setDefaultPath(parsed.defaultPath)
      } catch {}
    }
  }, [])

  const save = () => {
    localStorage.setItem('hangar-settings', JSON.stringify({ defaultHarness, defaultModel, port: Number(port), defaultPath }))
    toast.success('Settings saved')
  }
  const copyToken = () => { navigator.clipboard.writeText(token); toast.success('Token copied') }
  const regenerateToken = async () => { const d = await api.regenerateToken(); setToken(d.token); toast.success('Token regenerated') }
  const availableHarnesses = harnesses.filter((h) => h.available)

  return (
    <div className='mx-auto max-w-2xl space-y-6 p-6'>
      <h1 className='text-2xl font-bold tracking-tight'>Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Defaults</CardTitle>
          <CardDescription>Configure your Hangar workspace defaults.</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-2'>
            <Label htmlFor='harness'>Default Harness</Label>
            <Select value={defaultHarness} onValueChange={setDefaultHarness}>
              <SelectTrigger id='harness'><SelectValue /></SelectTrigger>
              <SelectContent>
                {availableHarnesses.map((h) => (<SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='model'>Default Model</Label>
            <Select value={defaultModel} onValueChange={setDefaultModel}>
              <SelectTrigger id='model'><SelectValue placeholder='Select a model' /></SelectTrigger>
              <SelectContent>
                {models.map((m) => (<SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='port'>Backend Port</Label>
            <Input id='port' type='number' value={port} onChange={(e) => setPort(e.target.value)} />
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='defaultPath'>Default Projects Path</Label>
            <Input id='defaultPath' value={defaultPath} onChange={(e) => setDefaultPath(e.target.value)} placeholder={homeDir || 'e.g. ~/workspace'} />
            <p className='text-xs text-muted-foreground'>Use <code>~</code> for your home directory.</p>
          </div>
          <Button onClick={save}>Save</Button>
        </CardContent>
      </Card>

      {/* Access */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            Access
            <Badge variant={tunnelActive ? 'default' : 'secondary'} className='text-[10px]'>
              {tunnelActive ? '\uD83C\uDF10 Public' : '\uD83D\uDCE1 LAN'}
            </Badge>
          </CardTitle>
          <CardDescription>Remote access via Cloudflare Tunnel (no account needed). Run <code className='bg-muted px-1 rounded text-xs'>npm run start:public</code></CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-2'>
            <Label>LAN Address</Label>
            <Input value={lanIP ? `http://${lanIP}:${port}` : 'Loading...'} readOnly />
          </div>
          <div className='grid gap-2'>
            <Label>Auth Token</Label>
            <div className='flex gap-2'>
              <Input value={token} readOnly className='font-mono text-xs' />
              <Button size='sm' variant='outline' onClick={copyToken}>Copy</Button>
              <Button size='sm' variant='outline' onClick={regenerateToken}>Regenerate</Button>
            </div>
            <p className='text-xs text-muted-foreground'>Required for public URL access. Append <code className='bg-muted px-1 rounded text-[11px]'>?token=...</code> to the URL.</p>
          </div>
          {tunnelActive && tunnelUrl && (
            <div className='grid gap-2'>
              <Label>Public URL</Label>
              <Input value={tunnelUrl} readOnly className='font-mono text-xs' />
            </div>
          )}
          <Hint open={hintTunnel} onOpenChange={setHintTunnel} title="How to set up Cloudflare Tunnel">
            <p><strong>1.</strong> No account or API key needed — Cloudflare Tunnel is bundled via <code className='bg-muted px-1 rounded'>cloudflared</code>.</p>
            <p><strong>2.</strong> Stop Hangar, then run: <code className='bg-muted px-1 rounded'>npm run start:public</code></p>
            <p><strong>3.</strong> A <code className='bg-muted px-1 rounded'>https://xxx.trycloudflare.com</code> URL + QR code appears in the terminal.</p>
            <p><strong>4.</strong> Copy the URL. Append <code className='bg-muted px-1 rounded'>?token=YOUR_TOKEN</code> (copy from Auth Token above).</p>
            <p><strong>5.</strong> Share the full URL. Anyone with the link + token can access Hangar.</p>
            <p><strong>6.</strong> Scan the terminal QR code with your phone camera for instant mobile access.</p>
            <p className='pt-1'>Docs: <a href='https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/' target='_blank' rel='noopener' className='underline text-blue-400'>Cloudflare Tunnel docs</a></p>
          </Hint>
        </CardContent>
      </Card>

      {/* Discord */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            Discord Bot
            <Badge variant={discordEnabled ? 'default' : 'secondary'} className='text-[10px]'>
              {discordEnabled ? '\uD83E\uDD16 Online' : 'Offline'}
            </Badge>
          </CardTitle>
          <CardDescription>Control your agents from Discord with slash commands.</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <Label>Enable Discord Bot</Label>
            <Switch checked={discordEnabled} onCheckedChange={setDiscordEnabled} />
          </div>
          {discordEnabled && (
            <>
              <div className='grid gap-2'>
                <Label>Bot Token</Label>
                <Input type='password' value={discordToken} onChange={(e) => setDiscordToken(e.target.value)} placeholder='Paste bot token from Discord Developer Portal' />
              </div>
              <div className='grid gap-2'>
                <Label>Channel ID</Label>
                <Input value={discordChannelId} onChange={(e) => setDiscordChannelId(e.target.value)} placeholder='Right-click channel → Copy ID' />
              </div>
              <Button onClick={async () => { await api.saveDiscord({ discordBotToken: discordToken, discordChannelId, discordEnabled }); toast.success('Discord saved — restart Hangar to apply'); }}>Save Discord</Button>
            </>
          )}
          <Hint open={hintDiscord} onOpenChange={setHintDiscord} title="How to create a Discord Bot">
            <p><strong>1.</strong> Go to <a href='https://discord.com/developers/applications' target='_blank' rel='noopener' className='underline text-blue-400'>discord.com/developers/applications</a></p>
            <p><strong>2.</strong> Click <strong>New Application</strong> → name it "Hangar".</p>
            <p><strong>3.</strong> Go to <strong>Bot</strong> tab → click <strong>Add Bot</strong>.</p>
            <p><strong>4.</strong> Click <strong>Reset Token</strong> → copy the token → paste in <strong>Bot Token</strong> above.</p>
            <p><strong>5.</strong> Under <strong>Privileged Gateway Intents</strong>, enable <strong>Message Content Intent</strong>.</p>
            <p><strong>6.</strong> Go to <strong>OAuth2 → URL Generator</strong>. Check <strong>bot</strong> + <strong>applications.commands</strong>. Copy the generated URL.</p>
            <p><strong>7.</strong> Open the URL in your browser → invite the bot to your server.</p>
            <p><strong>8.</strong> In Discord: right-click your target channel → <strong>Copy Channel ID</strong> → paste in <strong>Channel ID</strong> above.</p>
            <p><strong>9.</strong> Enable <strong>Developer Mode</strong> in Discord Settings → Advanced if you don't see "Copy ID".</p>
            <p><strong>10.</strong> Click <strong>Save Discord</strong>. Restart Hangar. Use <code className='bg-muted px-1 rounded'>/status</code> in Discord.</p>
            <p className='pt-1'>Docs: <a href='https://discordjs.guide/preparations/setting-up-a-bot-application.html' target='_blank' rel='noopener' className='underline text-blue-400'>discord.js setup guide</a></p>
          </Hint>
        </CardContent>
      </Card>

      {/* WhatsApp */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            WhatsApp Bot
            <Badge variant={whatsappStatus === 'online' ? 'default' : 'secondary'} className='text-[10px]'>
              {whatsappStatus === 'online' ? '\uD83D\uDCF1 Online' : 'Offline'}
            </Badge>
          </CardTitle>
          <CardDescription>Control your agents from WhatsApp. Commands: status, launch, stop, artifacts.</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <Label>Enable WhatsApp Bot</Label>
            <Switch checked={whatsappEnabled} onCheckedChange={setWhatsappEnabled} />
          </div>
          {whatsappEnabled && (
            <>
              <div className='grid gap-2'>
                <Label>Authorized Phone</Label>
                <Input value={whatsappPhone} onChange={(e) => setWhatsappPhone(e.target.value)} placeholder='5511999999999' />
              </div>
              {whatsappQR && (
                <div className='flex flex-col items-center gap-2'>
                  <Label>Scan QR Code</Label>
                  <img src={whatsappQR} alt='WhatsApp QR' className='w-48 h-48 border rounded' />
                  <p className='text-xs text-muted-foreground'>Open WhatsApp → Linked Devices → Scan</p>
                </div>
              )}
              <Button onClick={async () => { await api.saveWhatsApp({ whatsappEnabled, whatsappPhone }); toast.success('WhatsApp saved — restart Hangar to apply'); }}>Save WhatsApp</Button>
            </>
          )}
          <Hint open={hintWhatsApp} onOpenChange={setHintWhatsApp} title="How to set up WhatsApp Bot">
            <p><strong>1.</strong> No paid API needed — uses <code className='bg-muted px-1 rounded'>whatsapp-web.js</code> (WhatsApp Web).</p>
            <p><strong>2.</strong> Enter your phone number with country code (e.g. <code className='bg-muted px-1 rounded'>5511999999999</code>).</p>
            <p><strong>3.</strong> Click <strong>Save WhatsApp</strong> and restart Hangar.</p>
            <p><strong>4.</strong> A QR code will appear above — scan it with your phone.</p>
            <p><strong>5.</strong> On your phone: <strong>WhatsApp → Settings → Linked Devices → Link a Device</strong>.</p>
            <p><strong>6.</strong> Once connected, send <code className='bg-muted px-1 rounded'>status</code> to your Hangar WhatsApp number to test.</p>
            <p><strong>7.</strong> Commands: <code className='bg-muted px-1 rounded'>status</code>, <code className='bg-muted px-1 rounded'>launch project_name prompt</code>, <code className='bg-muted px-1 rounded'>stop project_name</code>, <code className='bg-muted px-1 rounded'>artifacts project_name</code>.</p>
            <p><strong>Note:</strong> Keep your phone connected to the internet. WhatsApp Web mirrors your phone.</p>
            <p className='pt-1'>Docs: <a href='https://wwebjs.dev/guide/' target='_blank' rel='noopener' className='underline text-blue-400'>whatsapp-web.js guide</a></p>
          </Hint>
        </CardContent>
      </Card>

      {/* Archive */}
      <Card>
        <CardHeader>
          <CardTitle>Archive</CardTitle>
          <CardDescription>Archived projects ({archive.length})</CardDescription>
        </CardHeader>
        <CardContent>
          {archive.length === 0 ? (
            <p className='text-sm text-muted-foreground'>No archived projects.</p>
          ) : (
            <ScrollArea className='max-h-[300px]'>
              <div className='space-y-2'>
                {archive.map((p) => (
                  <div key={p.id} className='flex items-center justify-between rounded-md border bg-muted/30 px-4 py-3'>
                    <div>
                      <p className='text-sm font-medium'>{p.name}</p>
                      <p className='text-xs text-muted-foreground'>{p.harness} · {p.model} · {p.path}</p>
                      {p.archivedAt && <p className='text-[10px] text-muted-foreground'>Archived: {new Date(p.archivedAt).toLocaleDateString()}</p>}
                    </div>
                    <Badge variant='outline' className='text-[9px]'>{p.status}</Badge>
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

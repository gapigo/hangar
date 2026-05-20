// Detecta e extrai artifacts do stream bruto do PTY.
// Um "artifact" é qualquer bloco de output semanticamente distinto:
// thinking | plan | tool_use | diff | message

export class ArtifactParser {
  constructor(sessionId, onArtifact, onArtifactUpdate) {
    this.sessionId = sessionId
    this.onArtifact = onArtifact           // (artifact) => void — novo artifact completo
    this.onArtifactUpdate = onArtifactUpdate // (id, artifact) => void — chunk recebido
    this.buffer = ''
    this.current = null  // artifact em construção
    this.artifacts = []
  }

  // Chamado para cada chunk bruto do PTY (ANSI stripped para análise)
  push(raw) {
    // 1. Strip ANSI codes para análise (preserva raw para xterm)
    // eslint-disable-next-line no-control-regex
    const clean = raw.replace(/\x1B\[[0-9;]*[mGKHF]/g, '')
    this.buffer += clean

    // 2. Processa linhas completas (terminam com \n)
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() // última linha incompleta volta pro buffer

    for (const line of lines) {
      this._processLine(line)
    }
  }

  // Força fechamento do artifact atual (usado no fim da sessão)
  flush() {
    if (this.buffer.trim()) {
      this._processLine(this.buffer)
      this.buffer = ''
    }
    this._closeArtifact()
  }

  _processLine(line) {
    const trimmed = line.trim()

    // Detecta início de thinking block (XML tags do agente)
    if (trimmed.includes('<thinking>')) {
      this._closeArtifact()
      this._openArtifact('thinking', '\u{1F9E0} Thinking')
      return
    }

    // Detecta fim de thinking block
    if (this.current?.type === 'thinking' && trimmed.includes('</thinking>')) {
      this._closeArtifact()
      return
    }

    // Dentro de um thinking block, acumula linhas
    if (this.current?.type === 'thinking') {
      this._addLine(line)
      return
    }

    // Detecta tool use blocks
    if (/^(Running bash|Reading file|Writing file|Searching|Browsing):/.test(trimmed)) {
      this._closeArtifact()
      this._openArtifact('tool_use', '\uD83D\uDD27 ' + trimmed)
      this._addLine(line)
      this._closeArtifact()
      return
    }

    // Detecta início de diff (unified diff headers)
    if (trimmed.startsWith('--- ') || trimmed.startsWith('+++ ') || trimmed.startsWith('@@ ')) {
      if (!this.current || this.current.type !== 'diff') {
        this._closeArtifact()
        this._openArtifact('diff', '\uD83D\uDCC4 Code diff')
      }
      this._addLine(line)
      return
    }

    // Linhas de diff (+/-/ context lines) quando já estamos dentro de um diff
    if (this.current?.type === 'diff' && /^[+\- ]/.test(line) && !trimmed.startsWith('---') && !trimmed.startsWith('+++')) {
      this._addLine(line)
      return
    }

    // Detecta fim de diff (linha em branco ou mudança de contexto após diff)
    if (this.current?.type === 'diff' && trimmed === '') {
      this._closeArtifact()
      return
    }

    // Detecta plano/markdown (linhas com ## ou ─ separadores)
    if (trimmed.startsWith('## ') || trimmed.startsWith('### ') || /^\u2500{10,}/.test(trimmed)) {
      if (!this.current || this.current.type === 'message') {
        this._closeArtifact()
        const title = trimmed.startsWith('#') ? trimmed.replace(/^#+\s/, '') : 'Plan'
        this._openArtifact('plan', '\uD83D\uDCCB ' + title)
      }
      this._addLine(line)
      return
    }

    // Continuação de plan block
    if (this.current?.type === 'plan' && trimmed) {
      this._addLine(line)
      return
    }

    // Fim de plan block
    if (this.current?.type === 'plan' && trimmed === '') {
      this._closeArtifact()
      return
    }

    // Tudo mais é mensagem
    if (trimmed) {
      if (!this.current || this.current.type === 'thinking' || this.current.type === 'diff') {
        if (!this.current) this._openArtifact('message', '\uD83D\uDCAC Message')
      }
      if (this.current) this._addLine(line)
    } else if (this.current?.type === 'message') {
      // Blank line termina message
      this._closeArtifact()
    }
  }

  _openArtifact(type, title) {
    const id = `${this.sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    this.current = { id, type, title, lines: [], createdAt: Date.now(), comments: {} }
  }

  _addLine(line) {
    if (!this.current) return
    this.current.lines.push(line)
    this.onArtifactUpdate(this.current.id, this.current)
  }

  _closeArtifact() {
    if (!this.current || this.current.lines.length === 0) { this.current = null; return }
    this.artifacts.push(this.current)
    this.onArtifact(this.current)
    this.current = null
  }

  getArtifacts() { return this.artifacts }

  addComment(artifactId, lineIndex, text) {
    const a = this.artifacts.find(a => a.id === artifactId)
    if (!a) return null
    if (!a.comments[lineIndex]) a.comments[lineIndex] = []
    const comment = { id: Date.now().toString(), lineIndex, text, createdAt: new Date().toISOString(), resolved: false }
    a.comments[lineIndex].push(comment)
    return comment
  }

  resolveComment(artifactId, commentId) {
    const a = this.artifacts.find(a => a.id === artifactId)
    if (!a) return
    for (const comments of Object.values(a.comments)) {
      const c = comments.find(c => c.id === commentId)
      if (c) { c.resolved = true; return c }
    }
  }

  getPendingComments() {
    const pending = []
    for (const artifact of this.artifacts) {
      for (const [lineIndex, comments] of Object.entries(artifact.comments)) {
        for (const c of comments) {
          if (!c.resolved) pending.push({ artifact, lineIndex: parseInt(lineIndex), comment: c })
        }
      }
    }
    return pending
  }

  serializeCommentsAsXML() {
    const pending = this.getPendingComments()
    if (pending.length === 0) return null
    const lines = ['<feedback>']
    for (const { artifact, lineIndex, comment } of pending) {
      const codeLine = artifact.lines[lineIndex] || ''
      lines.push(`  <comment artifact="${artifact.type}" line="${lineIndex}">`)
      lines.push(`    <context>${codeLine.trim()}</context>`)
      lines.push(`    <note>${comment.text}</note>`)
      lines.push(`  </comment>`)
    }
    lines.push('</feedback>')
    return lines.join('\n')
  }
}

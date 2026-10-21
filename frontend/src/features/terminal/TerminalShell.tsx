import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { executeCLICommand } from '../../api/client'
import { useStore } from '../../state/store'

interface HistoryEntry {
  id: string
  command: string
  output: string
  isError?: boolean
  timestamp: string
}

// Helper to convert ANSI terminal escape codes to styled HTML
function renderAnsiToHtml(text: string): string {
  if (!text) return ''

  // Escape HTML characters first
  let escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Mapping ANSI codes to inline CSS styles
  const ansiStyles: Record<string, string> = {
    '1': 'font-weight: bold;',
    '4': 'text-decoration: underline;',
    '91': 'color: #ef4444; font-weight: bold;', // Red
    '92': 'color: #10b981; font-weight: bold;', // Green
    '93': 'color: #f59e0b; font-weight: bold;', // Yellow
    '94': 'color: #38bdf8;',                    // Blue
    '95': 'color: #8b5cf6;',                    // Magenta/Purple
    '96': 'color: #06b6d4; font-weight: bold;', // Cyan
    '31': 'color: #ef4444;',
    '32': 'color: #10b981;',
    '33': 'color: #f59e0b;',
    '34': 'color: #38bdf8;',
    '35': 'color: #8b5cf6;',
    '36': 'color: #06b6d4;',
    '0': '', // Reset
  }

  // Regex to match ANSI escape codes like \x1b[92m or \033[1m
  const ansiRegex = /\x1b\[([0-9;]+)m/g

  let currentSpanOpen = false
  escaped = escaped.replace(ansiRegex, (_, codes) => {
    const codeList = codes.split(';')
    let result = ''
    if (currentSpanOpen) {
      result += '</span>'
      currentSpanOpen = false
    }

    const styles: string[] = []
    for (const code of codeList) {
      if (code === '0') {
        // Reset code
        styles.length = 0
      } else if (ansiStyles[code]) {
        styles.push(ansiStyles[code])
      }
    }

    if (styles.length > 0) {
      result += `<span style="${styles.join(' ')}">`
      currentSpanOpen = true
    }
    return result
  })

  if (currentSpanOpen) {
    escaped += '</span>'
  }

  return escaped
}

const INITIAL_BANNER = `========================================================================
     AeroFS: ADVANCED OS STORAGE & CoW DEDUPLICATION SUBSYSTEM
========================================================================
  Course:    BITE303L Operating Systems (Storage & File System Recovery)
  Engine:    Copy-on-Write (APFS/ZFS) | 4KB Content-Addressable Blocks
  Integrity: Cryptographic Binary Merkle Trees | Self-Healing Storage
  Mode:      Interactive Web Subsystem Shell (Real-time Live Sync)
  Type 'help' for commands, or click the quick action chips below.
------------------------------------------------------------------------`

const QUICK_COMMANDS = [
  'help',
  'ls',
  'stats',
  'map',
  'scrub',
  'heal',
  'snap list',
  'whoami',
  'uname',
  'clear',
]

export default function TerminalShell() {
  const queryClient = useQueryClient()
  const showToast = useStore((s) => s.showToast)
  const addEvent = useStore((s) => s.addEvent)

  const [inputVal, setInputVal] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([
    {
      id: 'banner',
      command: '',
      output: INITIAL_BANNER,
      timestamp: new Date().toLocaleTimeString(),
    },
  ])
  const [cmdIndex, setCmdIndex] = useState<number>(-1)
  const [executedCommands, setExecutedCommands] = useState<string[]>([])

  const terminalEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll to bottom whenever history updates
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history])

  // Focus input on mount and on click
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const executeMutation = useMutation({
    mutationFn: (cmd: string) => executeCLICommand(cmd),
    onSuccess: (data, variables) => {
      // Invalidate relevant queries so UI reflects shell mutations in real-time
      queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      queryClient.invalidateQueries({ queryKey: ['files'] })
      queryClient.invalidateQueries({ queryKey: ['snapshots'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })

      const trimmedCmd = variables.trim().toLowerCase()

      // Handle 'clear' command client-side
      if (trimmedCmd === 'clear' || trimmedCmd === 'cls') {
        setHistory([])
        return
      }

      setHistory((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          command: variables,
          output: data.output || '  [Command executed with no output]',
          timestamp: new Date().toLocaleTimeString(),
        },
      ])

      // Log event to operation timeline
      addEvent({
        operation: `CLI: ${variables.split(' ')[0]}`,
        status: 'success',
        message: `Executed shell command: "${variables}"`,
      })
    },
    onError: (err: Error, variables) => {
      setHistory((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          command: variables,
          output: `\x1b[91mError: ${err.message}\x1b[0m`,
          isError: true,
          timestamp: new Date().toLocaleTimeString(),
        },
      ])
      showToast('error', `Shell command failed: ${err.message}`)
    },
  })

  const handleSubmit = (cmdToRun?: string) => {
    const rawCmd = (cmdToRun !== undefined ? cmdToRun : inputVal).trim()
    if (!rawCmd) return

    setExecutedCommands((prev) => [...prev, rawCmd])
    setCmdIndex(-1)
    setInputVal('')

    executeMutation.mutate(rawCmd)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (executedCommands.length === 0) return
      const nextIndex = cmdIndex === -1 ? executedCommands.length - 1 : Math.max(0, cmdIndex - 1)
      setCmdIndex(nextIndex)
      setInputVal(executedCommands[nextIndex])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (cmdIndex === -1) return
      const nextIndex = cmdIndex + 1
      if (nextIndex >= executedCommands.length) {
        setCmdIndex(-1)
        setInputVal('')
      } else {
        setCmdIndex(nextIndex)
        setInputVal(executedCommands[nextIndex])
      }
    }
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '1rem',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Top Header & Quick Commands */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.75rem',
        padding: '0.85rem 1.25rem',
        background: 'var(--bg-card)',
        borderRadius: '8px',
        border: '1px solid var(--border-dim)',
      }}>
        <div>
          <h2 style={{
            margin: 0,
            fontSize: '1.2rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            color: 'var(--text-primary)',
          }}>
            <span>💻</span> AeroFS Interactive Subsystem Terminal
          </h2>
          <p style={{ margin: '3px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Direct command-line shell controlling the active virtual block device with live two-way Web Studio synchronization.
          </p>
        </div>

        {/* Quick Command Chips */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginRight: '4px' }}>Quick:</span>
          {QUICK_COMMANDS.map((q) => (
            <button
              key={q}
              onClick={() => handleSubmit(q)}
              disabled={executeMutation.isPending}
              style={{
                background: 'var(--bg-panel)',
                color: 'var(--accent)',
                border: '1px solid var(--border-dim)',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontFamily: 'monospace',
                cursor: 'pointer',
                fontWeight: 600,
              }}
              title={`Execute '${q}'`}
            >
              {q}
            </button>
          ))}
          <button
            onClick={() => setHistory([])}
            style={{
              background: 'transparent',
              color: 'var(--text-muted)',
              border: '1px solid var(--border-dim)',
              padding: '3px 8px',
              borderRadius: '4px',
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Terminal Window Container */}
      <div
        onClick={() => inputRef.current?.focus()}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          background: '#070b14', // Classic dark console
          borderRadius: '8px',
          border: '1px solid #1e293b',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
          overflow: 'hidden',
          cursor: 'text',
        }}
      >
        {/* Terminal Title Bar */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 14px',
          background: '#0b1324',
          borderBottom: '1px solid #1e293b',
          userSelect: 'none',
        }}>
          {/* macOS window dots */}
          <div style={{ display: 'flex', gap: '6px' }}>
            <span
              onClick={(e) => { e.stopPropagation(); setHistory([]); }}
              style={{ width: '11px', height: '11px', borderRadius: '50%', background: '#ef4444', display: 'inline-block', cursor: 'pointer' }}
              title="Clear Terminal"
            />
            <span style={{ width: '11px', height: '11px', borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
            <span
              onClick={(e) => { e.stopPropagation(); handleSubmit('help'); }}
              style={{ width: '11px', height: '11px', borderRadius: '50%', background: '#10b981', display: 'inline-block', cursor: 'pointer' }}
              title="Help"
            />
          </div>

          <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'monospace', fontWeight: 600 }}>
            aerofs@kernel: ~ (bash / aerofs-cli tty1)
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
            <span style={{ fontSize: '0.7rem', color: '#10b981', fontWeight: 600, fontFamily: 'monospace' }}>
              LIVE SYNC
            </span>
          </div>
        </div>

        {/* Terminal Screen Body */}
        <div style={{
          flex: 1,
          padding: '1rem',
          overflowY: 'auto',
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
          fontSize: '0.85rem',
          lineHeight: 1.45,
          color: '#e2e8f0',
        }}>
          {history.map((entry) => (
            <div key={entry.id} style={{ marginBottom: '0.75rem' }}>
              {entry.command && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontWeight: 700 }}>
                  <span style={{ color: '#0ea5e9' }}>aerofs&gt;</span>
                  <span style={{ color: '#ffffff' }}>{entry.command}</span>
                  <span style={{ fontSize: '0.65rem', color: '#64748b', marginLeft: 'auto' }}>{entry.timestamp}</span>
                </div>
              )}
              {entry.output && (
                <div
                  style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    marginTop: entry.command ? '4px' : '0',
                    color: entry.isError ? '#f87171' : '#cbd5e1',
                  }}
                  dangerouslySetInnerHTML={{ __html: renderAnsiToHtml(entry.output) }}
                />
              )}
            </div>
          ))}

          {/* Prompt line */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '0.5rem' }}>
            <span style={{ color: '#0ea5e9', fontWeight: 700 }}>aerofs&gt;</span>
            <input
              ref={inputRef}
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={executeMutation.isPending}
              placeholder={executeMutation.isPending ? 'Executing…' : 'Type command (e.g. ls, stats, map, scrub, heal, help)...'}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#ffffff',
                fontFamily: 'inherit',
                fontSize: 'inherit',
                caretColor: '#10b981',
              }}
            />
            {executeMutation.isPending && (
              <span style={{ fontSize: '0.75rem', color: '#0ea5e9', fontStyle: 'italic' }}>
                running...
              </span>
            )}
          </div>

          <div ref={terminalEndRef} />
        </div>
      </div>
    </div>
  )
}

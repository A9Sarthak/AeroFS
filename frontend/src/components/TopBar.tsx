import type { HealthResponse, TelemetryResponse } from '../api/types'
import { useStore } from '../state/store'

interface Props {
  health?: HealthResponse
  status: 'loading' | 'connected' | 'disconnected'
  telemetry?: TelemetryResponse
  onRefresh: () => void
}

export default function TopBar({ health, status, telemetry, onRefresh }: Props) {
  const currentOperation = useStore((s) => s.currentOperation)
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)

  const diskLabel = health
    ? `${health.disk_path.split('/').pop()} · ${health.total_blocks} blocks · ${health.block_size / 1024}KiB/block`
    : 'Loading…'

  const statusText =
    status === 'connected' ? 'Connected' :
    status === 'loading'   ? 'Connecting…' :
    'Disconnected'

  return (
    <header className="topbar" role="banner">
      <div className="topbar-logo">
        <div className="logo-icon" aria-hidden="true">⚡</div>
        <div>
          <div>AeroFS Studio</div>
          <div className="logo-sub">3D Storage Simulator</div>
        </div>
      </div>

      <div className="topbar-divider" />

      <div className="topbar-disk-label" title="Virtual disk configuration">
        💾 {diskLabel}
      </div>

      <div className="topbar-status" role="status" aria-live="polite">
        <div className={`status-dot ${status}`} />
        <span>{statusText}</span>
      </div>

      {currentOperation && (
        <div className="topbar-op" aria-live="polite">
          ⟳ {currentOperation}
        </div>
      )}

      {telemetry && (
        <>
          <div className="topbar-divider" />
          <div className="topbar-disk-label" style={{ fontSize: '0.72rem' }}>
            📁 {telemetry.file_count} files &nbsp;|&nbsp; 📷 {telemetry.snapshot_count} snaps
          </div>
          {telemetry.disk.corrupted_blocks_count > 0 && (
            <div className="topbar-disk-label" style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#ef4444' }}>
              ⚠ {telemetry.disk.corrupted_blocks_count} corrupted
            </div>
          )}
        </>
      )}

      <div className="topbar-spacer" />

      {/* Day / Night Switch Toggle */}
      <button
        className="theme-switch-btn"
        onClick={toggleTheme}
        aria-label={`Switch to ${theme === 'dark' ? 'Day' : 'Night'} Mode`}
        title={`Currently in ${theme === 'dark' ? 'Night (Dark)' : 'Day (Light)'} Mode. Click to switch.`}
      >
        <span className="theme-switch-icon" aria-hidden="true">
          {theme === 'dark' ? '🌙' : '☀️'}
        </span>
        <span className="theme-switch-text">
          {theme === 'dark' ? 'Night' : 'Day'}
        </span>
        <span className={`theme-switch-track ${theme}`}>
          <span className="theme-switch-thumb" />
        </span>
      </button>

      <button className="topbar-action-btn" onClick={() => onRefresh()} aria-label="Refresh telemetry">
        🔄 Refresh
      </button>
    </header>
  )
}

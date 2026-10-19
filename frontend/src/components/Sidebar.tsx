import { useStore } from '../state/store'

const NAV_ITEMS = [
  { id: 'overview',   icon: '🌐', label: 'Overview' },
  { id: 'files',      icon: '📁', label: 'File System' },
  { id: 'storage',    icon: '🧊', label: '3D Storage Map' },
  { id: 'snapshots',  icon: '📷', label: 'Snapshots' },
  { id: 'integrity',  icon: '🔬', label: 'Integrity Lab' },
  { id: 'audit',      icon: '📋', label: 'Audit Log' },
  { id: 'benchmarks', icon: '📊', label: 'Benchmarks' },
  { id: 'settings',   icon: '⚙️', label: 'Settings' },
]

export default function Sidebar() {
  const activeView = useStore((s) => s.activeView)
  const setActiveView = useStore((s) => s.setActiveView)

  return (
    <nav className="sidebar" role="navigation" aria-label="Main navigation">
      <div className="sidebar-section-label">Navigation</div>
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          className={`nav-item ${activeView === item.id ? 'active' : ''}`}
          onClick={() => setActiveView(item.id)}
          aria-current={activeView === item.id ? 'page' : undefined}
          title={item.label}
        >
          <span className="nav-icon" aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

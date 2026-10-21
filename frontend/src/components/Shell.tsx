import { useQuery } from '@tanstack/react-query'
import { getHealth, getTelemetry } from '../api/client'
import { useStore } from '../state/store'
import TopBar from './TopBar'
import Sidebar from './Sidebar'
import Inspector from './Inspector'
import Timeline from './Timeline'
import ToastContainer from './ToastContainer'
import Overview from '../features/overview/Overview'
import FileManager from '../features/file-manager/FileManager'
import StorageMap from '../features/storage-map/StorageMap'
import Snapshots from '../features/snapshots/Snapshots'
import IntegrityLab from '../features/integrity-lab/IntegrityLab'
import LiveHealingDemo from '../features/integrity-lab/LiveHealingDemo'
import AuditLog from '../features/audit-log/AuditLog'
import Benchmarks from '../features/benchmarks/Benchmarks'
import Settings from '../features/settings/Settings'

const VIEW_COMPONENTS: Record<string, React.FC> = {
  overview: Overview,
  files: FileManager,
  storage: StorageMap,
  snapshots: Snapshots,
  integrity: IntegrityLab,
  'live-heal': LiveHealingDemo,
  audit: AuditLog,
  benchmarks: Benchmarks,
  settings: Settings,
}

export default function Shell() {
  const activeView = useStore((s) => s.activeView)

  const { data: health, isLoading: healthLoading, isError } = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    refetchInterval: 10_000,
  })

  const { data: telemetry, refetch: refetchTelemetry } = useQuery({
    queryKey: ['telemetry'],
    queryFn: getTelemetry,
    refetchInterval: 8_000,
  })

  const ActiveView = VIEW_COMPONENTS[activeView] ?? Overview

  const backendStatus = healthLoading ? 'loading' : isError ? 'disconnected' : 'connected'

  return (
    <div className="app-shell">
      <TopBar
        health={health}
        status={backendStatus}
        telemetry={telemetry}
        onRefresh={refetchTelemetry}
      />
      <Sidebar />
      <main className="workspace">
        <ActiveView />
      </main>
      <Inspector telemetry={telemetry} />
      <Timeline />
      <ToastContainer />
    </div>
  )
}

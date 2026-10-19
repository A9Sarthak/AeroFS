// ============================================================
//  AeroFS Studio — Global UI State (Zustand)
// ============================================================

import { create } from 'zustand'
import type { OperationEvent, BlockView, FileView, BlockDetails } from '../api/types'

interface UIState {
  // Navigation
  activeView: string
  setActiveView: (v: string) => void

  // Selected items (presentation state only)
  selectedFileName: string | null
  setSelectedFileName: (name: string | null) => void

  selectedBlockId: number | null
  setSelectedBlockId: (id: number | null) => void

  selectedSnapshotName: string | null
  setSelectedSnapshotName: (name: string | null) => void

  // Inspector data (populated after selection)
  inspectorBlock: BlockDetails | null
  setInspectorBlock: (b: BlockDetails | null) => void

  inspectorFile: FileView | null
  setInspectorFile: (f: FileView | null) => void

  // Highlighted blocks (e.g. for file-to-block relationship view)
  highlightedBlockIds: Set<number>
  setHighlightedBlockIds: (ids: Set<number>) => void

  // Operation events timeline
  events: OperationEvent[]
  addEvent: (e: Omit<OperationEvent, 'id' | 'timestamp'>) => void
  clearEvents: () => void

  // Current operation in progress
  currentOperation: string | null
  setCurrentOperation: (op: string | null) => void

  // 3D / 2D toggle
  use2DFallback: boolean
  setUse2DFallback: (v: boolean) => void

  // Block filter
  blockFilter: 'all' | 'free' | 'metadata' | 'unique' | 'shared' | 'corrupted'
  setBlockFilter: (f: UIState['blockFilter']) => void

  // Theme: Day (light) vs Night (dark)
  theme: 'dark' | 'light'
  toggleTheme: () => void
  setTheme: (t: 'dark' | 'light') => void

  // Toasts
  toasts: { id: string; type: 'success' | 'error' | 'warning'; message: string }[]
  showToast: (type: 'success' | 'error' | 'warning', message: string) => void
  dismissToast: (id: string) => void
}

const initialTheme: 'dark' | 'light' =
  typeof window !== 'undefined' && localStorage.getItem('aerofs_theme') === 'light'
    ? 'light'
    : 'dark'

if (typeof window !== 'undefined') {
  document.documentElement.setAttribute('data-theme', initialTheme)
}

export const useStore = create<UIState>((set, get) => ({
  theme: initialTheme,
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    if (typeof window !== 'undefined') {
      localStorage.setItem('aerofs_theme', next)
      document.documentElement.setAttribute('data-theme', next)
    }
    set({ theme: next })
  },
  setTheme: (t) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('aerofs_theme', t)
      document.documentElement.setAttribute('data-theme', t)
    }
    set({ theme: t })
  },

  activeView: 'overview',
  setActiveView: (v) => set({ activeView: v }),

  selectedFileName: null,
  setSelectedFileName: (name) => set({ selectedFileName: name }),

  selectedBlockId: null,
  setSelectedBlockId: (id) => set({ selectedBlockId: id }),

  selectedSnapshotName: null,
  setSelectedSnapshotName: (name) => set({ selectedSnapshotName: name }),

  inspectorBlock: null,
  setInspectorBlock: (b) => set({ inspectorBlock: b }),

  inspectorFile: null,
  setInspectorFile: (f) => set({ inspectorFile: f }),

  highlightedBlockIds: new Set(),
  setHighlightedBlockIds: (ids) => set({ highlightedBlockIds: ids }),

  events: [],
  addEvent: (e) => {
    const event: OperationEvent = {
      ...e,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toLocaleTimeString(),
    }
    set((s) => ({ events: [event, ...s.events].slice(0, 100) }))
  },
  clearEvents: () => set({ events: [] }),

  currentOperation: null,
  setCurrentOperation: (op) => set({ currentOperation: op }),

  use2DFallback: false,
  setUse2DFallback: (v) => set({ use2DFallback: v }),

  blockFilter: 'all',
  setBlockFilter: (f) => set({ blockFilter: f }),

  toasts: [],
  showToast: (type, message) => {
    const id = `toast-${Date.now()}`
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }))
    setTimeout(() => get().dismissToast(id), 4000)
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

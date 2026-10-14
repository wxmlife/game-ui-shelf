import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { LibraryRepository } from '../data/libraryRepository'
import type { LibrarySnapshot } from '../domain/models'

interface LibraryState {
  snapshot: LibrarySnapshot | null
  loading: boolean
  error: string | null
  refreshError: string | null
  repository: LibraryRepository
  refresh: () => Promise<void>
}

const LibraryContext = createContext<LibraryState | null>(null)

interface LibraryProviderProps {
  repository: LibraryRepository
  children: ReactNode
}

export function LibraryProvider({ repository, children }: LibraryProviderProps) {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const latestRequest = useRef(0)

  const loadSnapshot = useCallback(async (initial: boolean) => {
    const request = ++latestRequest.current
    if (initial) setLoading(true)
    setError(null)
    try {
      const nextSnapshot = await repository.getSnapshot()
      if (request === latestRequest.current) {
        setSnapshot(nextSnapshot)
        setRefreshError(null)
      }
    } catch (caught) {
      if (request !== latestRequest.current) return
      if (!initial) {
        setRefreshError(caught instanceof Error ? caught.message : '资料库刷新失败')
        throw caught
      }
      setError(caught instanceof Error ? caught.message : '资料库加载失败')
    } finally {
      if (request === latestRequest.current) setLoading(false)
    }
  }, [repository])

  const refresh = useCallback(() => loadSnapshot(false), [loadSnapshot])

  useEffect(() => {
    setSnapshot(null)
    setRefreshError(null)
    void loadSnapshot(true)
    return () => { latestRequest.current += 1 }
  }, [loadSnapshot])

  const value = useMemo(
    () => ({ snapshot, loading, error, refreshError, repository, refresh }),
    [snapshot, loading, error, refreshError, repository, refresh],
  )

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>
}

export function useLibrary(): LibraryState {
  const value = useContext(LibraryContext)
  if (!value) throw new Error('useLibrary must be used inside LibraryProvider')
  return value
}

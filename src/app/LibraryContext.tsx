import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import type { LibraryRepository } from '../data/libraryRepository'
import type { LibrarySnapshot } from '../domain/models'

interface LibraryState {
  snapshot: LibrarySnapshot | null
  loading: boolean
  error: string | null
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

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      setSnapshot(await repository.getSnapshot())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '资料库加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [repository])

  const value = useMemo(
    () => ({ snapshot, loading, error, repository, refresh }),
    [snapshot, loading, error, repository],
  )

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>
}

export function useLibrary(): LibraryState {
  const value = useContext(LibraryContext)
  if (!value) throw new Error('useLibrary must be used inside LibraryProvider')
  return value
}

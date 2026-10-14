import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { demoSnapshot } from '../data/demoData'
import { demoRepository } from '../data/demoRepository'
import type { LibrarySnapshot } from '../domain/models'
import { LibraryProvider, useLibrary } from './LibraryContext'

function snapshotNamed(name: string): LibrarySnapshot {
  const snapshot = structuredClone(demoSnapshot)
  snapshot.games[0].name = name
  return snapshot
}

function SnapshotProbe() {
  const { snapshot, loading, refresh } = useLibrary()
  const [refreshError, setRefreshError] = useState('')
  return (
    <>
      <p>{snapshot?.games[0]?.name ?? '空快照'}</p>
      <p>{loading ? '正在加载' : '已就绪'}</p>
      {refreshError && <p role="alert">{refreshError}</p>}
      <button
        type="button"
        onClick={() => void refresh().catch((error) => {
          setRefreshError(error instanceof Error ? error.message : '刷新失败')
        })}
      >
        刷新
      </button>
    </>
  )
}

describe('LibraryProvider refresh coordination', () => {
  it('keeps the current snapshot mounted during background refresh and ignores an older response', async () => {
    const user = userEvent.setup()
    let finishOlder!: (snapshot: LibrarySnapshot) => void
    let finishLatest!: (snapshot: LibrarySnapshot) => void
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce(snapshotNamed('初始快照'))
      .mockImplementationOnce(() => new Promise<LibrarySnapshot>((resolve) => { finishOlder = resolve }))
      .mockImplementationOnce(() => new Promise<LibrarySnapshot>((resolve) => { finishLatest = resolve }))
    const repository = { ...demoRepository, getSnapshot }

    render(
      <LibraryProvider repository={repository}>
        <SnapshotProbe />
      </LibraryProvider>,
    )
    expect(await screen.findByText('初始快照')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '刷新' }))
    await user.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3))
    expect(screen.getByText('初始快照')).toBeInTheDocument()
    expect(screen.getByText('已就绪')).toBeInTheDocument()

    await act(async () => finishLatest(snapshotNamed('最新快照')))
    expect(await screen.findByText('最新快照')).toBeInTheDocument()

    await act(async () => finishOlder(snapshotNamed('过期快照')))
    expect(screen.getByText('最新快照')).toBeInTheDocument()
    expect(screen.queryByText('过期快照')).not.toBeInTheDocument()
  })

  it('reports the latest background failure without accepting an older successful response', async () => {
    const user = userEvent.setup()
    let finishOlder!: (snapshot: LibrarySnapshot) => void
    let failLatest!: (error: Error) => void
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce(snapshotNamed('初始快照'))
      .mockImplementationOnce(() => new Promise<LibrarySnapshot>((resolve) => { finishOlder = resolve }))
      .mockImplementationOnce(() => new Promise<LibrarySnapshot>((_resolve, reject) => { failLatest = reject }))
    const repository = { ...demoRepository, getSnapshot }

    render(
      <LibraryProvider repository={repository}>
        <SnapshotProbe />
      </LibraryProvider>,
    )
    expect(await screen.findByText('初始快照')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '刷新' }))
    await user.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3))
    await act(async () => failLatest(new Error('云端刷新失败')))

    expect(await screen.findByRole('alert')).toHaveTextContent('云端刷新失败')
    expect(screen.getByText('初始快照')).toBeInTheDocument()
    expect(screen.getByText('已就绪')).toBeInTheDocument()

    await act(async () => finishOlder(snapshotNamed('过期成功快照')))
    expect(screen.getByText('初始快照')).toBeInTheDocument()
    expect(screen.queryByText('过期成功快照')).not.toBeInTheDocument()
  })
})

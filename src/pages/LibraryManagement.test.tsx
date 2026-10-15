import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from '../app/App'
import { LibraryProvider } from '../app/LibraryContext'
import { demoSnapshot } from '../data/demoData'
import type { LibraryRepository, MutationResult } from '../data/libraryRepository'
import type { LibrarySnapshot } from '../domain/models'
import { LibraryPage } from './LibraryPage'

afterEach(() => {
  window.location.hash = '#/'
})

function shelfFixture(mode: LibraryRepository['mode'] = 'cloud') {
  const gameA = { ...demoSnapshot.games[0], id: 'game-a', name: '游戏甲', imageCount: 2 }
  const gameB = { ...demoSnapshot.games[0], id: 'game-b', name: '游戏乙', imageCount: 1 }
  const moduleA = { ...demoSnapshot.modules[0], id: 'module-a', gameId: gameA.id }
  const moduleB = { ...demoSnapshot.modules[0], id: 'module-b', gameId: gameB.id }
  const images = [
    { ...demoSnapshot.images[0], id: 'image-a1', gameId: gameA.id, moduleId: moduleA.id },
    { ...demoSnapshot.images[0], id: 'image-a2', gameId: gameA.id, moduleId: moduleA.id },
    { ...demoSnapshot.images[0], id: 'image-b1', gameId: gameB.id, moduleId: moduleB.id },
  ]
  const snapshot: LibrarySnapshot = {
    games: [gameA, gameB],
    modules: [moduleA, moduleB],
    images,
    captureSets: [],
  }
  const repository: LibraryRepository = {
    mode,
    getSnapshot: vi.fn(async () => structuredClone(snapshot)),
    submitImport: vi.fn(),
    deleteGame: vi.fn(async (gameId: string) => {
      snapshot.games = snapshot.games.filter((game) => game.id !== gameId)
      snapshot.modules = snapshot.modules.filter((module) => module.gameId !== gameId)
      snapshot.images = snapshot.images.filter((image) => image.gameId !== gameId)
      return { status: 'complete' as const }
    }),
  }
  window.location.hash = '#/'
  return { snapshot, repository }
}

async function enterManagement(user: ReturnType<typeof userEvent.setup>) {
  const manage = await screen.findByRole('button', { name: '管理游戏' })
  expect(manage).toHaveAttribute('aria-pressed', 'false')
  await user.click(manage)
  expect(manage).toHaveAttribute('aria-pressed', 'true')
  return manage
}

function ShelfLifecycleHarness({ repository }: { repository: LibraryRepository }) {
  const [showShelf, setShowShelf] = useState(true)
  return (
    <MemoryRouter>
      <LibraryProvider repository={repository}>
        <button type="button" onClick={() => setShowShelf((current) => !current)}>
          {showShelf ? '离开书架' : '返回书架'}
        </button>
        {showShelf ? <LibraryPage /> : <h1>另一页面</h1>}
      </LibraryProvider>
    </MemoryRouter>
  )
}

describe('bookshelf game management', () => {
  it('offers whole-game deletion from shelf management mode but never inside a book', async () => {
    const user = userEvent.setup()
    const { repository } = shelfFixture()
    render(<App repository={repository} />)

    expect(await screen.findByRole('heading', { name: '游戏书架' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除游戏 游戏甲' })).not.toBeInTheDocument()
    await enterManagement(user)
    expect(screen.getByRole('button', { name: '删除游戏 游戏甲' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除游戏 游戏乙' })).toBeInTheDocument()
    expect(screen.queryByText(/输入完整游戏名称/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: '打开 游戏甲' }))
    expect(await screen.findByRole('heading', { name: '游戏甲' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除游戏' })).not.toBeInTheDocument()
  })

  it('confirms a whole-game deletion directly, focuses confirmation, deletes only that shelf card, and restores focus', async () => {
    const user = userEvent.setup()
    const { repository } = shelfFixture()
    render(<App repository={repository} />)

    const manage = await enterManagement(user)
    await user.click(screen.getByRole('button', { name: '删除游戏 游戏甲' }))
    const dialog = screen.getByRole('alertdialog', { name: '删除游戏确认' })
    expect(dialog).toHaveTextContent('游戏「游戏甲」')
    expect(dialog).toHaveTextContent('2 张图片')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: '确认删除' })
    expect(confirm).toBeEnabled()
    expect(confirm).toHaveFocus()
    await user.click(confirm)

    await waitFor(() => expect(screen.queryByRole('link', { name: '打开 游戏甲' })).not.toBeInTheDocument())
    expect(screen.getByRole('link', { name: '打开 游戏乙' })).toBeInTheDocument()
    expect(repository.deleteGame).toHaveBeenCalledTimes(1)
    expect(repository.deleteGame).toHaveBeenCalledWith('game-a')
    expect(repository.getSnapshot).toHaveBeenCalledTimes(2)
    expect(manage).toHaveFocus()
  })

  it('cancels with either Escape or the cancel button without deleting and restores focus', async () => {
    const user = userEvent.setup()
    const { repository } = shelfFixture()
    render(<App repository={repository} />)

    await enterManagement(user)
    const deleteGame = screen.getByRole('button', { name: '删除游戏 游戏甲' })
    await user.click(deleteGame)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(repository.deleteGame).not.toHaveBeenCalled()
    expect(deleteGame).toHaveFocus()

    await user.click(deleteGame)
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(repository.deleteGame).not.toHaveBeenCalled()
    expect(deleteGame).toHaveFocus()
  })

  it('keeps a failed deletion in its dialog so it can be retried safely', async () => {
    const user = userEvent.setup()
    const { repository, snapshot } = shelfFixture()
    repository.deleteGame = vi.fn()
      .mockRejectedValueOnce(new Error('删除游戏失败'))
      .mockImplementationOnce(async (gameId: string): Promise<MutationResult> => {
        snapshot.games = snapshot.games.filter((game) => game.id !== gameId)
        snapshot.modules = snapshot.modules.filter((module) => module.gameId !== gameId)
        snapshot.images = snapshot.images.filter((image) => image.gameId !== gameId)
        return { status: 'complete' }
      })
    render(<App repository={repository} />)

    await enterManagement(user)
    await user.click(screen.getByRole('button', { name: '删除游戏 游戏甲' }))
    await user.click(screen.getByRole('button', { name: '确认删除' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('删除游戏失败')
    expect(screen.getByRole('alertdialog', { name: '删除游戏确认' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开 游戏甲' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(screen.queryByRole('link', { name: '打开 游戏甲' })).not.toBeInTheDocument())
    expect(repository.deleteGame).toHaveBeenCalledTimes(2)
  })

  it('refreshes the shared shelf after a deletion finishes on another route', async () => {
    const user = userEvent.setup()
    const { repository, snapshot } = shelfFixture()
    let finishDelete!: () => void
    repository.deleteGame = vi.fn((gameId: string) => new Promise<MutationResult>((resolve) => {
      finishDelete = () => {
        snapshot.games = snapshot.games.filter((game) => game.id !== gameId)
        snapshot.modules = snapshot.modules.filter((module) => module.gameId !== gameId)
        snapshot.images = snapshot.images.filter((image) => image.gameId !== gameId)
        resolve({ status: 'complete' })
      }
    }))
    render(<ShelfLifecycleHarness repository={repository} />)

    await enterManagement(user)
    await user.click(screen.getByRole('button', { name: '删除游戏 游戏甲' }))
    await user.click(screen.getByRole('button', { name: '确认删除' }))

    await user.click(screen.getByRole('button', { name: '离开书架' }))
    expect(screen.getByRole('heading', { name: '另一页面' })).toBeInTheDocument()
    await act(async () => finishDelete())

    await waitFor(() => expect(repository.getSnapshot).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: '返回书架' }))
    expect(await screen.findByRole('heading', { name: '游戏书架' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '打开 游戏甲' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开 游戏乙' })).toBeInTheDocument()
  })

  it('keeps partial cleanup and refresh failures visible on the shelf', async () => {
    const user = userEvent.setup()
    const { repository, snapshot } = shelfFixture()
    repository.deleteGame = vi.fn(async () => {
      snapshot.games = snapshot.games.slice(1)
      snapshot.modules = snapshot.modules.filter((module) => module.gameId !== 'game-a')
      snapshot.images = snapshot.images.filter((image) => image.gameId !== 'game-a')
      return { status: 'partial' as const, pendingCleanup: 1, message: '游戏已删除，1 个文件等待清理' }
    })
    repository.getSnapshot = vi.fn()
      .mockResolvedValueOnce(structuredClone(snapshot))
      .mockRejectedValueOnce(new Error('云端快照刷新失败'))
    render(<App repository={repository} />)

    await enterManagement(user)
    await user.click(screen.getByRole('button', { name: '删除游戏 游戏甲' }))
    await user.click(screen.getByRole('button', { name: '确认删除' }))

    expect(await screen.findByRole('status')).toHaveTextContent('游戏已删除，1 个文件等待清理')
    expect(await screen.findByRole('alert')).toHaveTextContent('资料库刷新失败，当前内容可能不是最新：云端快照刷新失败')
  })

  it.each(['demo', 'missing'] as const)('hides shelf game management when deletion is %s', async (availability) => {
    const { repository } = shelfFixture(availability === 'demo' ? 'demo' : 'cloud')
    if (availability === 'missing') delete repository.deleteGame
    render(<App repository={repository} />)

    expect(await screen.findByRole('heading', { name: '游戏书架' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '管理游戏' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /删除游戏 / })).not.toBeInTheDocument()
  })
})

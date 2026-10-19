import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from '../app/App'
import { demoSnapshot } from '../data/demoData'
import type { LibraryRepository } from '../data/libraryRepository'
import type { LibrarySnapshot } from '../domain/models'

afterEach(() => {
  window.location.hash = '#/'
})

function coverFixture(options: { coverUrl?: string; coverFocusX?: number; coverFocusY?: number } = {}) {
  const game = {
    ...demoSnapshot.games[0],
    id: 'cover-game',
    name: '封面测试游戏',
    coverUrl: options.coverUrl,
    coverFocusX: options.coverFocusX ?? 50,
    coverFocusY: options.coverFocusY ?? 50,
  }
  const module = { ...demoSnapshot.modules[0], id: 'cover-module', gameId: game.id }
  const image = {
    ...demoSnapshot.images[0],
    id: 'cover-image',
    gameId: game.id,
    moduleId: module.id,
    title: '候选封面',
  }
  const snapshot: LibrarySnapshot = { games: [game], modules: [module], images: [image], captureSets: [] }
  const repository: LibraryRepository = {
    mode: 'cloud',
    getSnapshot: vi.fn(async () => structuredClone(snapshot)),
    submitImport: vi.fn(),
    setGameCoverFromImageWithFocus: vi.fn(async (gameId: string, imageId: string, x: number, y: number) => {
      expect(gameId).toBe(game.id)
      expect(imageId).toBe(image.id)
      snapshot.games[0].coverUrl = 'https://storage.example/new-cover.webp'
      snapshot.games[0].coverFocusX = x
      snapshot.games[0].coverFocusY = y
      return { status: 'complete' as const }
    }),
    updateGameCoverFocus: vi.fn(async (gameId: string, x: number, y: number) => {
      expect(gameId).toBe(game.id)
      snapshot.games[0].coverFocusX = x
      snapshot.games[0].coverFocusY = y
      return { status: 'complete' as const }
    }),
  }
  window.location.hash = `#/game/${game.id}`
  return { repository }
}

describe('game cover management', () => {
  it('opens cover management from the game header and saves a chosen screenshot with its focal point', async () => {
    const user = userEvent.setup()
    const { repository } = coverFixture()

    render(<App repository={repository} />)

    await user.click(await screen.findByRole('button', { name: '设置游戏封面' }))
    expect(screen.getByRole('dialog', { name: '调整游戏封面' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '选择截图：候选封面' }))
    fireEvent.change(screen.getByRole('slider', { name: '横向焦点' }), { target: { value: '32' } })
    await user.click(screen.getByRole('button', { name: '保存封面' }))

    await waitFor(() => expect(repository.setGameCoverFromImageWithFocus).toHaveBeenCalledWith('cover-game', 'cover-image', 32, 50))
    expect(repository.updateGameCoverFocus).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '调整游戏封面' })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: '更换或调整游戏封面' })).toHaveFocus())
  })

  it('applies the saved focal point and allows focus-only cover adjustments', async () => {
    const user = userEvent.setup()
    const { repository } = coverFixture({
      coverUrl: 'https://storage.example/current-cover.webp',
      coverFocusX: 18,
      coverFocusY: 72,
    })

    render(<App repository={repository} />)

    const cover = await screen.findByRole('img', { name: '封面测试游戏游戏封面' })
    expect(cover).toHaveStyle({ objectPosition: '18% 72%' })
    await user.click(screen.getByRole('button', { name: '更换或调整游戏封面' }))
    await user.click(screen.getByRole('button', { name: '保存封面' }))

    await waitFor(() => expect(repository.updateGameCoverFocus).toHaveBeenCalledWith('cover-game', 18, 72))
    expect(repository.setGameCoverFromImageWithFocus).not.toHaveBeenCalled()
  })

  it('opens the focal-point editor with the viewed screenshot preselected before changing the cover', async () => {
    const user = userEvent.setup()
    const { repository } = coverFixture({
      coverUrl: 'https://storage.example/current-cover.webp',
      coverFocusX: 18,
      coverFocusY: 72,
    })

    render(<App repository={repository} />)

    await user.click(await screen.findByRole('button', { name: '查看 候选封面' }))
    await user.click(screen.getByRole('button', { name: '设为游戏封面' }))

    expect(screen.queryByRole('dialog', { name: '候选封面' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '调整游戏封面' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '选择截图：候选封面' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('img', { name: '封面构图原图' })).toHaveAttribute('src', demoSnapshot.images[0].imageUrl)
    expect(screen.getByRole('slider', { name: '横向焦点' })).toHaveValue('50')
    expect(screen.getByRole('slider', { name: '纵向焦点' })).toHaveValue('50')
    expect(repository.setGameCoverFromImageWithFocus).not.toHaveBeenCalled()

    fireEvent.change(screen.getByRole('slider', { name: '纵向焦点' }), { target: { value: '64' } })
    await user.click(screen.getByRole('button', { name: '保存封面' }))

    await waitFor(() => expect(repository.setGameCoverFromImageWithFocus).toHaveBeenCalledWith('cover-game', 'cover-image', 50, 64))
    expect(repository.updateGameCoverFocus).not.toHaveBeenCalled()
    await waitFor(() => expect(document.querySelector('.game-hero-cover img')).toHaveAttribute('src', 'https://storage.example/new-cover.webp'))
  })
})

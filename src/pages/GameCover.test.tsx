import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from '../app/App'
import { demoSnapshot } from '../data/demoData'
import type { LibraryRepository } from '../data/libraryRepository'
import type { LibrarySnapshot } from '../domain/models'

afterEach(() => {
  window.location.hash = '#/'
})

function coverFixture() {
  const game = { ...demoSnapshot.games[0], id: 'cover-game', name: '封面测试游戏', coverUrl: undefined }
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
    setGameCoverFromImage: vi.fn(async (gameId: string, imageId: string) => {
      expect(gameId).toBe(game.id)
      expect(imageId).toBe(image.id)
      snapshot.games[0].coverUrl = 'https://storage.example/new-cover.webp'
      return { status: 'complete' as const }
    }),
  }
  window.location.hash = `#/game/${game.id}`
  return { repository }
}

describe('game cover management', () => {
  it('sets the open screenshot as cover, refreshes the game, and reveals the new cover', async () => {
    const user = userEvent.setup()
    const { repository } = coverFixture()

    render(<App repository={repository} />)

    await user.click(await screen.findByRole('button', { name: '查看 候选封面' }))
    await user.click(screen.getByRole('button', { name: '设为游戏封面' }))

    await waitFor(() => expect(repository.setGameCoverFromImage).toHaveBeenCalledWith('cover-game', 'cover-image'))
    await waitFor(() => expect(repository.getSnapshot).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog', { name: '候选封面' })).not.toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('.game-hero-cover img')).toHaveAttribute('src', 'https://storage.example/new-cover.webp'))
  })
})

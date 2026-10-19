import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { demoSnapshot } from '../data/demoData'
import '../styles/index.css'
import { GameCard } from './GameCard'

describe('GameCard', () => {
  it('centers the game initials when no cover image is available', () => {
    const game = { ...demoSnapshot.games[0], coverUrl: undefined }

    render(
      <MemoryRouter>
        <GameCard game={game} />
      </MemoryRouter>,
    )

    const cover = screen.getByRole('link', { name: `打开 ${game.name}` })
    const placeholder = within(cover).getByText(game.name.slice(0, 2), { selector: 'span' })
    expect(placeholder).toHaveStyle({
      display: 'grid',
      width: '100%',
      height: '100%',
      placeItems: 'center',
    })
  })
})

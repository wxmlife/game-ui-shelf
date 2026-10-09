import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from './App'

function renderAt(hash: string) {
  window.location.hash = hash
  return render(<App />)
}

afterEach(() => {
  window.location.hash = '#/'
})

describe('App browsing experience', () => {
  it('shows the game bookshelf with its catalog', async () => {
    renderAt('#/')

    expect(await screen.findByRole('heading', { name: '游戏书架' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开 IDOL Empire' })).toBeInTheDocument()
    expect(screen.getByText('4 本游戏')).toBeInTheDocument()
  })

  it('searches from the global search box and opens matching results', async () => {
    const user = userEvent.setup()
    renderAt('#/')

    const search = await screen.findByRole('searchbox', { name: '全库搜索' })
    await user.type(search, '奖励领取{Enter}')

    expect(await screen.findByRole('heading', { name: '搜索结果' })).toBeInTheDocument()
    expect(screen.getByText('奖励领取')).toBeInTheDocument()
    expect(screen.getByText('找到 1 张截图')).toBeInTheDocument()
  })

  it('groups a known game by module and flow', async () => {
    renderAt('#/game/idol-empire')

    expect(await screen.findByRole('heading', { name: 'IDOL Empire' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '奖励' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '领取奖励' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看 奖励详情' })).toBeInTheDocument()
  })

  it('shows a useful state for an unknown game', async () => {
    renderAt('#/game/not-here')

    expect(await screen.findByRole('heading', { name: '没找到这个游戏' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回游戏书架' })).toBeInTheDocument()
  })

  it('keeps modules with no screenshots visible', async () => {
    renderAt('#/game/idol-empire')

    expect(await screen.findByRole('heading', { name: '设置' })).toBeInTheDocument()
    expect(screen.getByText('这个模块还没有截图')).toBeInTheDocument()
  })

  it('opens and closes the image viewer', async () => {
    const user = userEvent.setup()
    renderAt('#/game/idol-empire')

    await user.click(await screen.findByRole('button', { name: '查看 奖励详情' }))
    expect(screen.getByRole('dialog', { name: '奖励详情' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '关闭大图' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '奖励详情' })).not.toBeInTheDocument()
    })
  })
})

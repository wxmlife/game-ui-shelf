import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from '../app/App'
import { demoSnapshot } from '../data/demoData'
import type { LibraryRepository } from '../data/libraryRepository'

afterEach(() => {
  window.location.hash = '#/'
})

describe('cloud metadata editing', () => {
  it('edits an existing module and image metadata', async () => {
    const user = userEvent.setup()
    const updateModule = vi.fn().mockResolvedValue({ status: 'complete' })
    const updateImageMetadata = vi.fn().mockResolvedValue({ status: 'complete' })
    const repository: LibraryRepository = {
      mode: 'cloud',
      getSnapshot: vi.fn().mockResolvedValue(structuredClone(demoSnapshot)),
      submitImport: vi.fn(),
      updateModule,
      updateImageMetadata,
    }
    window.location.hash = '#/game/idol-empire'
    render(<App repository={repository} />)

    await user.click(await screen.findByRole('button', { name: '编辑 奖励模块' }))
    const moduleName = screen.getByLabelText('模块显示名称')
    await user.clear(moduleName)
    await user.type(moduleName, '奖励与邮件')
    await user.click(screen.getByRole('button', { name: '保存模块' }))
    await waitFor(() => expect(updateModule).toHaveBeenCalledWith('idol-empire-reward', {
      key: 'reward',
      name: '奖励与邮件',
    }))

    await user.click(screen.getByRole('button', { name: '查看 奖励详情' }))
    await user.click(screen.getByRole('button', { name: '编辑图片资料' }))
    const title = screen.getByLabelText('图片标题')
    await user.clear(title)
    await user.type(title, '奖励内容详情')
    const tags = screen.getByLabelText('图片标签')
    await user.clear(tags)
    await user.type(tags, '弹窗, 奖励, 金币')
    await user.click(screen.getByRole('button', { name: '保存图片资料' }))

    await waitFor(() => expect(updateImageMetadata).toHaveBeenCalledWith('idol-reward-detail', {
      moduleId: 'idol-empire-reward',
      title: '奖励内容详情',
      flowName: '领取奖励',
      sequenceOrder: 2,
      tags: ['弹窗', '奖励', '金币'],
    }))
  })
})

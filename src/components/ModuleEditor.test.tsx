import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { GameModule } from '../domain/models'
import { ModuleEditor } from './ModuleEditor'

const module: GameModule = {
  id: 'module-1',
  gameId: 'game-1',
  key: 'guild',
  name: '公会',
  sortOrder: 1,
}

describe('ModuleEditor', () => {
  it('renders as a named inline region and form without modal semantics or backdrop', () => {
    const { container } = render(
      <ModuleEditor module={module} onClose={vi.fn()} onSave={vi.fn()} />,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(container.querySelector('[aria-modal]')).not.toBeInTheDocument()
    expect(container.querySelector('.editor-backdrop')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '编辑 公会模块' })).toBeInTheDocument()
    expect(screen.getByRole('form', { name: '编辑模块' })).toBeInTheDocument()
  })

  it('trims the module fields before saving and leaves closing to the parent', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ModuleEditor module={module} onClose={onClose} onSave={onSave} />)

    await user.clear(screen.getByRole('textbox', { name: '模块标识' }))
    await user.type(screen.getByRole('textbox', { name: '模块标识' }), '  alliance  ')
    await user.clear(screen.getByRole('textbox', { name: '模块显示名称' }))
    await user.type(screen.getByRole('textbox', { name: '模块显示名称' }), '  联盟  ')
    await user.click(screen.getByRole('button', { name: '保存模块' }))

    expect(onSave).toHaveBeenCalledWith({ key: 'alliance', name: '联盟' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows a save error and allows the user to retry', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
      .mockRejectedValueOnce(new Error('保存失败，请重试'))
      .mockResolvedValueOnce(undefined)
    render(<ModuleEditor module={module} onClose={vi.fn()} onSave={onSave} />)

    await user.click(screen.getByRole('button', { name: '保存模块' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败，请重试')
    expect(screen.getByRole('form', { name: '编辑模块' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存模块' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '保存模块' }))

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('calls onClose when the cancel button is pressed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ModuleEditor module={module} onClose={onClose} onSave={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '取消编辑' }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})

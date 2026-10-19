import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { UiImage } from '../domain/models'
import '../styles/index.css'
import { GameCoverEditor } from './GameCoverEditor'

const images: UiImage[] = [
  {
    id: 'image-1',
    gameId: 'game-1',
    moduleId: 'module-1',
    moduleKey: '公会',
    moduleName: '公会',
    title: '总榜已解锁',
    originalFilename: '公会_总榜已解锁.jpeg',
    imageUrl: 'https://storage.example/image-1.jpeg',
    thumbnailUrl: 'https://storage.example/image-1-thumb.webp',
    width: 1170,
    height: 2532,
    sequenceOrder: 1,
    tags: ['公会'],
    createdAt: '2026-10-10T00:00:00Z',
  },
  {
    id: 'image-2',
    gameId: 'game-1',
    moduleId: 'module-1',
    moduleKey: '公会',
    moduleName: '公会',
    title: '赛季排名',
    originalFilename: '公会_赛季排名.jpeg',
    imageUrl: 'https://storage.example/image-2.jpeg',
    thumbnailUrl: 'https://storage.example/image-2-thumb.webp',
    width: 1170,
    height: 2532,
    sequenceOrder: 2,
    tags: ['公会', '排名'],
    createdAt: '2026-10-10T00:00:00Z',
  },
]

describe('GameCoverEditor', () => {
  it('shows the current cover in both crop previews and clamps its initial focus', () => {
    render(
      <GameCoverEditor
        images={images}
        currentCoverUrl="https://storage.example/current-cover.webp"
        initialFocus={{ x: -20, y: 140 }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByRole('img', { name: '封面构图原图' })).toHaveAttribute('src', 'https://storage.example/current-cover.webp')
    expect(screen.getByRole('img', { name: '书架横版封面预览' })).toHaveStyle({ objectPosition: '0% 100%' })
    expect(screen.getByRole('img', { name: '详情竖版封面预览' })).toHaveStyle({ objectPosition: '0% 100%' })
    expect(screen.getByRole('slider', { name: '横向焦点' })).toHaveValue('0')
    expect(screen.getByRole('slider', { name: '纵向焦点' })).toHaveValue('100')
    expect(screen.getByRole('button', { name: '保存封面' })).toHaveFocus()
  })

  it('previews a selected screenshot and saves it with the keyboard-adjusted focus', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <GameCoverEditor
        images={images}
        currentCoverUrl="https://storage.example/current-cover.webp"
        initialFocus={{ x: 50, y: 50 }}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    )

    await user.click(screen.getByRole('button', { name: '选择截图：赛季排名' }))
    expect(screen.getByRole('img', { name: '封面构图原图' })).toHaveAttribute('src', images[1].imageUrl)
    expect(screen.getByRole('button', { name: '选择截图：赛季排名' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.change(screen.getByRole('slider', { name: '横向焦点' }), { target: { value: '35' } })
    fireEvent.change(screen.getByRole('slider', { name: '纵向焦点' }), { target: { value: '72' } })
    await user.click(screen.getByRole('button', { name: '保存封面' }))

    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenCalledWith({ image: images[1], focus: { x: 35, y: 72 } })
  })

  it('saves a focus-only edit when the existing cover remains selected', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <GameCoverEditor
        images={images}
        currentCoverUrl="https://storage.example/current-cover.webp"
        initialFocus={{ x: 50, y: 50 }}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.change(screen.getByRole('slider', { name: '横向焦点' }), { target: { value: '61' } })
    await user.click(screen.getByRole('button', { name: '保存封面' }))

    expect(onSave).toHaveBeenCalledWith({ image: undefined, focus: { x: 61, y: 50 } })
  })

  it('requires a screenshot when the game has no current cover', async () => {
    const user = userEvent.setup()
    render(
      <GameCoverEditor
        images={images}
        initialFocus={{ x: 50, y: 50 }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByText('请先选择一张游戏截图作为封面。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存封面' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '选择截图：总榜已解锁' }))

    expect(screen.getByRole('button', { name: '保存封面' })).toBeEnabled()
  })

  it('maps pointer focus against the contained image bounds and clamps letterbox clicks', () => {
    render(
      <GameCoverEditor
        images={images}
        currentCoverUrl="https://storage.example/current-cover.webp"
        initialFocus={{ x: 50, y: 50 }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    const focusControl = screen.getByLabelText('拖动设置封面焦点')
    const focusImage = screen.getByRole('img', { name: '封面构图原图' })
    Object.defineProperties(focusImage, {
      naturalWidth: { configurable: true, value: 100 },
      naturalHeight: { configurable: true, value: 200 },
    })
    vi.spyOn(focusControl, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 200,
      width: 200,
      height: 100,
      right: 300,
      bottom: 300,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    })
    vi.spyOn(focusImage, 'getBoundingClientRect').mockReturnValue({
      left: 102,
      top: 202,
      width: 196,
      height: 96,
      right: 298,
      bottom: 298,
      x: 102,
      y: 202,
      toJSON: () => ({}),
    })

    expect(focusImage).toHaveStyle({ objectFit: 'contain' })

    fireEvent.pointerDown(focusControl, { clientX: 176, clientY: 226, pointerId: 1 })
    expect(screen.getByRole('slider', { name: '横向焦点' })).toHaveValue('0')
    expect(screen.getByRole('slider', { name: '纵向焦点' })).toHaveValue('25')
    expect(focusControl.querySelector('.cover-focus-marker')).toHaveStyle({ left: '38%', top: '26%' })

    fireEvent.pointerMove(focusControl, { clientX: 240, clientY: 320, pointerId: 1 })
    expect(screen.getByRole('slider', { name: '横向焦点' })).toHaveValue('100')
    expect(screen.getByRole('slider', { name: '纵向焦点' })).toHaveValue('100')
  })

  it('keeps forward and reverse Tab navigation inside the dialog', async () => {
    const user = userEvent.setup()
    const outside = document.createElement('button')
    outside.textContent = '对话框外按钮'
    document.body.append(outside)

    render(
      <GameCoverEditor
        images={images}
        currentCoverUrl="https://storage.example/current-cover.webp"
        initialFocus={{ x: 50, y: 50 }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    const close = screen.getByRole('button', { name: '关闭封面编辑' })
    const save = screen.getByRole('button', { name: '保存封面' })
    const dialog = screen.getByRole('dialog', { name: '调整游戏封面' })
    const focusableControls = Array.from(dialog.querySelectorAll(':is(input, button):not(:disabled)'))
    expect(focusableControls[0]).toBe(close)
    expect(focusableControls.at(-1)).toBe(save)

    save.focus()
    await user.tab()
    expect(close).toHaveFocus()

    await user.tab({ shift: true })
    expect(save).toHaveFocus()

    outside.remove()
  })

  it('skips the pointer-only focal-point surface in keyboard tab order', async () => {
    const user = userEvent.setup()
    render(
      <GameCoverEditor
        images={images}
        currentCoverUrl="https://storage.example/current-cover.webp"
        initialFocus={{ x: 50, y: 50 }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    screen.getByRole('button', { name: '关闭封面编辑' }).focus()
    await user.tab()

    expect(screen.getByRole('slider', { name: '横向焦点' })).toHaveFocus()
  })

  it('puts the landscape and portrait ratios on image-only crop containers', () => {
    render(
      <GameCoverEditor
        images={images}
        currentCoverUrl="https://storage.example/current-cover.webp"
        initialFocus={{ x: 50, y: 50 }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    const landscapeImage = screen.getByRole('img', { name: '书架横版封面预览' })
    const portraitImage = screen.getByRole('img', { name: '详情竖版封面预览' })
    expect(landscapeImage.parentElement).toHaveClass('cover-preview-image')
    expect(landscapeImage.parentElement).toHaveStyle({ aspectRatio: '1.6' })
    expect(portraitImage.parentElement).toHaveClass('cover-preview-image')
    expect(portraitImage.parentElement).toHaveStyle({ aspectRatio: '4 / 5' })
    expect(landscapeImage.closest('figure')).not.toHaveStyle({ aspectRatio: '1.6' })
  })

  it('closes with Escape and restores focus to the previously focused control', () => {
    const onClose = vi.fn()
    const opener = document.createElement('button')
    opener.textContent = '原来的按钮'
    document.body.append(opener)
    opener.focus()

    const result = render(
      <GameCoverEditor
        images={images}
        currentCoverUrl="https://storage.example/current-cover.webp"
        initialFocus={{ x: 50, y: 50 }}
        onClose={onClose}
        onSave={vi.fn()}
      />,
    )

    fireEvent.keyDown(screen.getByRole('dialog', { name: '调整游戏封面' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()

    result.unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('shows save progress and errors without allowing duplicate actions', () => {
    render(
      <GameCoverEditor
        images={images}
        currentCoverUrl="https://storage.example/current-cover.webp"
        initialFocus={{ x: 50, y: 50 }}
        busy
        error="封面保存失败，请重试"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('封面保存失败，请重试')
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
    expect(screen.getByRole('slider', { name: '横向焦点' })).toBeDisabled()
  })
})

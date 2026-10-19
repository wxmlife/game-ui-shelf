import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from '../app/App'
import { demoSnapshot } from '../data/demoData'
import { demoRepository } from '../data/demoRepository'
import type { LibraryRepository, MutationResult } from '../data/libraryRepository'
import type { LibrarySnapshot } from '../domain/models'

afterEach(() => {
  window.location.hash = '#/'
})

function managementFixture() {
  const game = { ...demoSnapshot.games[0], id: 'game', name: '测试游戏' }
  const modules = ['源模块', '目标模块', '空模块'].map((name, index) => ({
    id: `module-${index}`, gameId: game.id, key: name, name, sortOrder: index,
  }))
  const images = ['图片甲', '图片乙', '图片丙'].map((title, index) => ({
    ...demoSnapshot.images[0], id: `image-${index}`, gameId: game.id,
    moduleId: modules[index === 2 ? 1 : 0].id, moduleName: modules[index === 2 ? 1 : 0].name,
    title, flowId: index === 2 ? 'flow-other' : 'flow-source', flowName: '同名流程', sequenceOrder: index + 1,
  }))
  const snapshot: LibrarySnapshot = { games: [game], modules, images, captureSets: [] }
  const placeImage = vi.fn(async (imageId: string, moduleId: string, beforeImageId: string | null) => {
    const image = snapshot.images.find((item) => item.id === imageId)!
    const sourceModuleId = image.moduleId
    image.moduleId = moduleId
    image.moduleName = modules.find((module) => module.id === moduleId)!.name
    const targetImages = snapshot.images
      .filter((item) => item.moduleId === moduleId && item.id !== imageId)
      .sort((a, b) => a.sequenceOrder - b.sequenceOrder || a.id.localeCompare(b.id))
    const insertionIndex = beforeImageId === null
      ? targetImages.length
      : Math.max(0, targetImages.findIndex((item) => item.id === beforeImageId))
    targetImages.splice(insertionIndex, 0, image)
    targetImages.forEach((item, index) => { item.sequenceOrder = index + 1 })
    snapshot.images
      .filter((item) => item.moduleId === sourceModuleId)
      .sort((a, b) => a.sequenceOrder - b.sequenceOrder || a.id.localeCompare(b.id))
      .forEach((item, index) => { item.sequenceOrder = index + 1 })
    return { status: 'complete' as const }
  })
  const repository: LibraryRepository = {
    mode: 'cloud', getSnapshot: vi.fn(async () => structuredClone(snapshot)), submitImport: vi.fn(),
    deleteImages: vi.fn(async (ids: string[]) => {
      snapshot.images = snapshot.images.filter((image) => !ids.includes(image.id))
      return { status: 'complete' as const }
    }),
    deleteGame: vi.fn(async () => { snapshot.games = []; snapshot.images = []; return { status: 'complete' as const } }),
    moveImage: vi.fn(async () => ({ status: 'complete' as const })),
  }
  Object.assign(repository, { placeImage })
  window.location.hash = '#/game/game'
  return { snapshot, repository, placeImage }
}

function twoGameFixture() {
  const fixture = managementFixture()
  fixture.snapshot.games.push({ ...fixture.snapshot.games[0], id: 'game-b', name: '另一游戏' })
  fixture.snapshot.modules.push({ ...fixture.snapshot.modules[0], id: 'module-b', gameId: 'game-b', name: '另一模块' })
  fixture.snapshot.images.push({ ...fixture.snapshot.images[0], id: 'image-b', gameId: 'game-b', moduleId: 'module-b', title: '另一图片' })
  return fixture
}

describe('game image management', () => {
  it.each(['drag', 'dialog'] as const)('locks stale cards and metadata while a %s move is pending, then restores editing', async (method) => {
    const user = userEvent.setup()
    const { repository, snapshot } = managementFixture()
    let finishMove!: () => void
    Object.assign(repository, { placeImage: vi.fn(() => new Promise<MutationResult>((resolve) => {
      finishMove = () => { snapshot.images[0].moduleId = 'module-2'; resolve({ status: 'complete' }) }
    })) })
    repository.updateModule = vi.fn(async () => ({ status: 'complete' as const }))
    repository.updateImageMetadata = vi.fn(async () => ({ status: 'complete' as const }))
    render(<App repository={repository} />)
    const handle = await screen.findByRole('button', { name: '移动 图片甲 到模块或位置' })
    if (method === 'dialog') {
      await user.click(handle)
      await user.selectOptions(screen.getByRole('combobox', { name: '目标模块' }), 'module-2')
      await user.click(screen.getByRole('button', { name: '确认移动' }))
    } else {
      const dataTransfer = {
        types: ['application/x-ui-image'], setData: vi.fn(), getData: () => 'image-0', effectAllowed: '', dropEffect: '',
      }
      fireEvent.dragStart(handle, { dataTransfer })
      fireEvent.drop(screen.getByRole('region', { name: '空模块' }), { dataTransfer })
    }
    const preview = screen.getByRole('button', { name: '查看 图片甲' })
    expect(preview).toBeDisabled()
    expect(screen.getByRole('button', { name: '编辑 源模块模块' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '删除游戏' })).not.toBeInTheDocument()
    await user.click(preview)
    expect(screen.queryByRole('dialog', { name: '图片甲' })).not.toBeInTheDocument()
    expect(repository.updateImageMetadata).not.toHaveBeenCalled()
    await act(async () => finishMove())
    await user.click(await screen.findByRole('button', { name: '查看 图片甲' }))
    await user.click(screen.getByRole('button', { name: '编辑图片资料' }))
    await user.click(screen.getByRole('button', { name: '保存图片资料' }))
    await waitFor(() => expect(repository.updateImageMetadata).toHaveBeenCalledWith('image-0', expect.objectContaining({ moduleId: 'module-2' })))
  })

  it('shares the mutation lock with metadata saving and releases it after failure', async () => {
    const user = userEvent.setup()
    const { repository, placeImage } = managementFixture()
    let failSave!: (error: Error) => void
    repository.updateImageMetadata = vi.fn(() => new Promise<MutationResult>((_resolve, reject) => { failSave = reject }))
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('button', { name: '查看 图片甲' }))
    await user.click(screen.getByRole('button', { name: '编辑图片资料' }))
    await user.click(screen.getByRole('button', { name: '保存图片资料' }))
    expect(screen.getByRole('button', { name: '移动 图片甲 到模块或位置' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '移动 图片甲 到模块或位置' }))
    expect(placeImage).not.toHaveBeenCalled()
    await act(async () => failSave(new Error('保存失败')))
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败')
    expect(screen.getByRole('button', { name: '保存图片资料' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '移动 图片甲 到模块或位置' })).toBeEnabled()
  })

  it.each(['selection', 'deletion', 'move', 'viewer'] as const)('clears %s state when navigating directly to another game', async (state) => {
    const user = userEvent.setup()
    const { repository } = twoGameFixture()
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('checkbox', { name: '选择 图片甲' }))
    if (state === 'deletion') await user.click(screen.getByRole('button', { name: '删除已选' }))
    if (state === 'move') await user.click(screen.getByRole('button', { name: '移动 图片甲 到模块或位置' }))
    if (state === 'viewer') await user.click(screen.getByRole('button', { name: '查看 图片甲' }))
    await act(async () => { window.location.hash = '#/game/game-b' })
    await screen.findByRole('heading', { name: '另一游戏' })
    expect(screen.queryByRole('toolbar', { name: '图片批量管理' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: '选择 另一图片' }))
    await user.click(screen.getByRole('button', { name: '删除已选' }))
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(repository.deleteImages).toHaveBeenCalledWith(['image-b']))
    expect(repository.deleteImages).toHaveBeenCalledTimes(1)
  })

  it.each(['complete', 'reject'] as const)('ignores an old game request that finishes with %s after navigation', async (outcome) => {
    const user = userEvent.setup()
    const { repository, snapshot } = twoGameFixture()
    let finish!: () => void
    Object.assign(repository, { placeImage: vi.fn(() => new Promise<MutationResult>((resolve, reject) => {
      finish = () => {
        if (outcome === 'complete') {
          snapshot.images.find((image) => image.id === 'image-0')!.moduleId = 'module-2'
          resolve({ status: 'complete' })
        } else {
          reject(new Error('旧游戏移动失败'))
        }
      }
    })) })
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('button', { name: '移动 图片甲 到模块或位置' }))
    await user.selectOptions(screen.getByRole('combobox', { name: '目标模块' }), 'module-2')
    await user.click(screen.getByRole('button', { name: '确认移动' }))
    await act(async () => { window.location.hash = '#/game/game-b' })
    await screen.findByRole('heading', { name: '另一游戏' })
    await user.click(screen.getByRole('button', { name: '移动 另一图片 到模块或位置' }))
    expect(screen.getByRole('dialog', { name: '移动到模块' })).toHaveTextContent('另一图片')
    await act(async () => finish())
    expect(screen.getByRole('dialog', { name: '移动到模块' })).toHaveTextContent('另一图片')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    if (outcome === 'complete') {
      await waitFor(() => expect(repository.getSnapshot).toHaveBeenCalledTimes(2))
      expect(screen.getByRole('dialog', { name: '移动到模块' })).toHaveTextContent('另一图片')
      await act(async () => { window.location.hash = '#/game/game' })
      expect(await within(await screen.findByRole('region', { name: '空模块' })).findByRole('button', { name: '查看 图片甲' })).toBeInTheDocument()
    } else {
      expect(repository.getSnapshot).toHaveBeenCalledTimes(1)
    }
  })

  it('refreshes the shared snapshot after a deletion succeeds on a route that was left', async () => {
    const user = userEvent.setup()
    const { repository, snapshot } = twoGameFixture()
    let finishDelete!: () => void
    let finishRefresh!: () => void
    let snapshotRead = 0
    repository.getSnapshot = vi.fn(() => {
      snapshotRead += 1
      if (snapshotRead === 1) return Promise.resolve(structuredClone(snapshot))
      return new Promise<LibrarySnapshot>((resolve) => {
        finishRefresh = () => resolve(structuredClone(snapshot))
      })
    })
    repository.deleteImages = vi.fn((ids: string[]) => new Promise<MutationResult>((resolve) => {
      finishDelete = () => {
        snapshot.images = snapshot.images.filter((image) => !ids.includes(image.id))
        resolve({ status: 'complete' })
      }
    }))
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('checkbox', { name: '选择 图片甲' }))
    await user.click(screen.getByRole('button', { name: '删除已选' }))
    await user.click(screen.getByRole('button', { name: '确认删除' }))

    await act(async () => { window.location.hash = '#/game/game-b' })
    await screen.findByRole('heading', { name: '另一游戏' })
    await user.click(screen.getByRole('button', { name: '移动 另一图片 到模块或位置' }))
    expect(screen.getByRole('dialog', { name: '移动到模块' })).toHaveTextContent('另一图片')

    await act(async () => finishDelete())

    await waitFor(() => expect(repository.getSnapshot).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('dialog', { name: '移动到模块' })).toHaveTextContent('另一图片')
    await act(async () => finishRefresh())
    await waitFor(() => expect(screen.getByRole('dialog', { name: '移动到模块' })).toHaveTextContent('另一图片'))
    await act(async () => { window.location.hash = '#/game/game' })
    await screen.findByRole('heading', { name: '测试游戏' })
    expect(screen.queryByRole('button', { name: '查看 图片甲' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看 图片乙' })).toBeInTheDocument()
  })

  it('refreshes shared metadata after an edit succeeds without overwriting the new route state', async () => {
    const user = userEvent.setup()
    const { repository, snapshot } = twoGameFixture()
    let finishEdit!: () => void
    repository.updateImageMetadata = vi.fn((imageId, update) => new Promise<MutationResult>((resolve) => {
      finishEdit = () => {
        snapshot.images.find((image) => image.id === imageId)!.title = update.title
        resolve({ status: 'complete' })
      }
    }))
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('button', { name: '查看 图片甲' }))
    await user.click(screen.getByRole('button', { name: '编辑图片资料' }))
    const title = screen.getByLabelText('图片标题')
    await user.clear(title)
    await user.type(title, '已更新图片')
    await user.click(screen.getByRole('button', { name: '保存图片资料' }))

    await act(async () => { window.location.hash = '#/game/game-b' })
    await user.click(await screen.findByRole('checkbox', { name: '选择 另一图片' }))
    expect(screen.getByRole('toolbar', { name: '图片批量管理' })).toHaveTextContent('已选 1 张')

    await act(async () => finishEdit())

    await waitFor(() => expect(repository.getSnapshot).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('toolbar', { name: '图片批量管理' })).toHaveTextContent('已选 1 张')
    await act(async () => { window.location.hash = '#/game/game' })
    expect(await screen.findByRole('button', { name: '查看 已更新图片' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看 图片甲' })).not.toBeInTheDocument()
  })

  it('renders one flat ordered grid per module and uses the same order in the viewer', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/game/idol-empire'
    render(<App repository={demoRepository} />)

    const taskModule = await screen.findByRole('region', { name: '任务' })
    expect(taskModule.querySelectorAll('.image-grid')).toHaveLength(1)
    expect(within(taskModule).queryByRole('heading', { name: '完成任务' })).not.toBeInTheDocument()
    expect(within(taskModule).getAllByRole('button', { name: /查看 / }).map((button) => button.getAttribute('aria-label'))).toEqual([
      '查看 任务列表',
      '查看 任务完成',
    ])

    await user.click(await screen.findByRole('button', { name: '查看 任务完成' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('2 / 2')
    await user.click(screen.getByRole('button', { name: '下一张' }))
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: '任务列表' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '关闭大图' }))

    const rewardModule = screen.getByRole('region', { name: '奖励' })
    expect(rewardModule.querySelectorAll('.image-grid')).toHaveLength(1)
    expect(within(rewardModule).queryByRole('heading', { name: '领取奖励' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '查看 奖励入口' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('1 / 3')
    await user.click(screen.getByRole('button', { name: '下一张' }))
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: '奖励详情' })).toBeInTheDocument()
  })

  it('requires a count confirmation for viewer deletion and refreshes the cards', async () => {
    const user = userEvent.setup()
    const { repository } = managementFixture()
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('button', { name: '查看 图片甲' }))
    await user.click(screen.getByRole('button', { name: '删除图片' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('1 张')
    expect(repository.deleteImages).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '查看 图片甲' })).not.toBeInTheDocument())
    expect(await screen.findByRole('button', { name: '查看 图片乙' })).toBeInTheDocument()
    expect(repository.deleteImages).toHaveBeenCalledWith(['image-0'])
    expect(repository.getSnapshot).toHaveBeenCalledTimes(2)
  })

  it('selects across modules, can cancel selection, and deletes only the confirmed selection', async () => {
    const user = userEvent.setup()
    const { repository } = managementFixture()
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('checkbox', { name: '选择 图片甲' }))
    await user.click(screen.getByRole('button', { name: '取消选择' }))
    expect(screen.getByRole('checkbox', { name: '选择 图片甲' })).not.toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: '选择 图片甲' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 图片丙' }))
    expect(screen.getByRole('toolbar', { name: '图片批量管理' })).toHaveTextContent('已选 2 张')
    await user.click(screen.getByRole('button', { name: '删除已选' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('2 张')
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(repository.deleteImages).toHaveBeenCalledWith(['image-0', 'image-2']))
    expect(await screen.findByRole('button', { name: '查看 图片乙' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看 图片丙' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '目标模块' })).getByText('这个模块还没有截图')).toBeInTheDocument()
  })

  it('opens movement with the keyboard and places an image at a chosen module position', async () => {
    const user = userEvent.setup()
    const { repository, snapshot, placeImage } = managementFixture()
    snapshot.images.push({ ...snapshot.images[2], id: 'image-3', title: '图片丁', sequenceOrder: 4 })
    render(<App repository={repository} />)
    const handle = await screen.findByRole('button', { name: '移动 图片甲 到模块或位置' })
    handle.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: '移动到模块' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(handle).toHaveFocus()
    await user.click(handle)
    expect(screen.getByRole('combobox', { name: '目标模块' })).toHaveValue('module-0')
    expect(screen.getByRole('combobox', { name: '目标位置' })).toHaveValue('image-1')
    await user.selectOptions(screen.getByRole('combobox', { name: '目标模块' }), 'module-1')
    await user.selectOptions(screen.getByRole('combobox', { name: '目标位置' }), 'image-3')
    await user.click(screen.getByRole('button', { name: '确认移动' }))
    await waitFor(() => expect(placeImage).toHaveBeenCalledWith('image-0', 'module-1', 'image-3'))
    expect(within(await screen.findByRole('region', { name: '目标模块' })).getAllByRole('button', { name: /查看 / }).map((button) => button.getAttribute('aria-label'))).toEqual([
      '查看 图片丙',
      '查看 图片甲',
      '查看 图片丁',
    ])
    expect(repository.getSnapshot).toHaveBeenCalledTimes(2)
  })

  it('drags only the explicit handle onto module whitespace to append and preserves the emptied source', async () => {
    const { repository, snapshot, placeImage } = managementFixture()
    snapshot.images = [snapshot.images[0]]
    render(<App repository={repository} />)
    const handle = await screen.findByRole('button', { name: '移动 图片甲 到模块或位置' })
    expect(handle).toHaveAttribute('draggable', 'true')
    expect(screen.getByRole('button', { name: '查看 图片甲' })).not.toHaveAttribute('draggable', 'true')
    const dataTransfer = { setData: vi.fn(), getData: () => '', effectAllowed: '' }
    fireEvent.dragStart(handle, { dataTransfer })
    fireEvent.dragStart(handle, { dataTransfer })
    fireEvent.dragOver(screen.getByRole('region', { name: '空模块' }), { dataTransfer })
    fireEvent.drop(screen.getByRole('region', { name: '空模块' }), { dataTransfer })
    await waitFor(() => expect(placeImage).toHaveBeenCalledWith('image-0', 'module-2', null))
    expect(await within(await screen.findByRole('region', { name: '源模块' })).findByText('这个模块还没有截图')).toBeInTheDocument()
  })

  it('reorders within a module by dropping on the left half of a card', async () => {
    const { repository, placeImage } = managementFixture()
    render(<App repository={repository} />)
    const handle = await screen.findByRole('button', { name: '移动 图片乙 到模块或位置' })
    const targetCard = screen.getByRole('button', { name: '查看 图片甲' }).closest('article')!
    Object.defineProperty(targetCard, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 100, width: 200 }) })
    const dataTransfer = { types: ['application/x-ui-image'], setData: vi.fn(), getData: () => 'image-1', effectAllowed: '', dropEffect: '' }

    fireEvent.dragStart(handle, { dataTransfer })
    const dragOver = createEvent.dragOver(targetCard, { dataTransfer })
    Object.defineProperty(dragOver, 'clientX', { value: 120 })
    fireEvent(targetCard, dragOver)
    expect(targetCard).toHaveClass('is-drop-before')
    const drop = createEvent.drop(targetCard, { dataTransfer })
    Object.defineProperty(drop, 'clientX', { value: 120 })
    fireEvent(targetCard, drop)

    await waitFor(() => expect(placeImage).toHaveBeenCalledWith('image-1', 'module-0', 'image-0'))
    expect(within(await screen.findByRole('region', { name: '源模块' })).getAllByRole('button', { name: /查看 / }).map((button) => button.getAttribute('aria-label'))).toEqual([
      '查看 图片乙',
      '查看 图片甲',
    ])
  })

  it('inserts after a cross-module card from its right half without bubbling a second drop', async () => {
    const { repository, snapshot, placeImage } = managementFixture()
    snapshot.images.push({ ...snapshot.images[2], id: 'image-3', title: '图片丁', sequenceOrder: 4 })
    render(<App repository={repository} />)
    const handle = await screen.findByRole('button', { name: '移动 图片甲 到模块或位置' })
    const targetCard = screen.getByRole('button', { name: '查看 图片丙' }).closest('article')!
    Object.defineProperty(targetCard, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 100, width: 200 }) })
    const dataTransfer = { types: ['application/x-ui-image'], setData: vi.fn(), getData: () => 'image-0', effectAllowed: '', dropEffect: '' }

    fireEvent.dragStart(handle, { dataTransfer })
    const dragOver = createEvent.dragOver(targetCard, { dataTransfer })
    Object.defineProperty(dragOver, 'clientX', { value: 280 })
    fireEvent(targetCard, dragOver)
    expect(targetCard).toHaveClass('is-drop-after')
    const drop = createEvent.drop(targetCard, { dataTransfer })
    Object.defineProperty(drop, 'clientX', { value: 280 })
    fireEvent(targetCard, drop)

    await waitFor(() => expect(placeImage).toHaveBeenCalledWith('image-0', 'module-1', 'image-3'))
    expect(placeImage).toHaveBeenCalledTimes(1)
    expect(within(await screen.findByRole('region', { name: '目标模块' })).getAllByRole('button', { name: /查看 / }).map((button) => button.getAttribute('aria-label'))).toEqual([
      '查看 图片丙',
      '查看 图片甲',
      '查看 图片丁',
    ])
  })

  it('uses the transfer payload on a sticky module chip even when React drag state is unavailable', async () => {
    const { repository, snapshot, placeImage } = managementFixture()
    const updateImageMetadata = vi.fn(async () => ({ status: 'complete' as const }))
    repository.updateImageMetadata = updateImageMetadata
    const originalTitle = snapshot.images[0].title
    const originalTags = [...snapshot.images[0].tags]
    render(<App repository={repository} />)

    const moduleNav = await screen.findByRole('navigation', { name: '模块目录' })
    const targetChip = within(moduleNav).getByRole('link', { name: '空模块' })
    const dataTransfer = {
      types: ['application/x-ui-image'],
      getData: vi.fn(() => 'image-0'),
      dropEffect: '',
    }

    fireEvent.dragOver(targetChip, { dataTransfer })
    expect(targetChip).toHaveClass('is-drop-target')
    fireEvent.drop(targetChip, { dataTransfer })

    await waitFor(() => expect(placeImage).toHaveBeenCalledWith('image-0', 'module-2', null))
    expect(dataTransfer.getData).toHaveBeenCalledWith('application/x-ui-image')
    expect(updateImageMetadata).not.toHaveBeenCalled()
    expect(snapshot.images[0]).toMatchObject({ title: originalTitle, tags: originalTags })
  })

  it('scrolls to a module when its sticky navigation chip is clicked', async () => {
    const user = userEvent.setup()
    const { repository } = managementFixture()
    render(<App repository={repository} />)

    const targetModule = await screen.findByRole('region', { name: '目标模块' })
    const scrollIntoView = vi.fn()
    Object.defineProperty(targetModule, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    const moduleNav = screen.getByRole('navigation', { name: '模块目录' })

    await user.click(within(moduleNav).getByRole('link', { name: '目标模块' }))

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(window.location.hash).toBe('#/game/game')
  })

  it('prefers the transfer payload over stale React drag state', async () => {
    const { repository, placeImage } = managementFixture()
    render(<App repository={repository} />)

    const staleHandle = await screen.findByRole('button', { name: '移动 图片甲 到模块或位置' })
    fireEvent.dragStart(staleHandle, {
      dataTransfer: {
        types: ['application/x-ui-image'],
        setData: vi.fn(),
        effectAllowed: '',
      },
    })

    const targetChip = within(screen.getByRole('navigation', { name: '模块目录' })).getByRole('link', { name: '空模块' })
    fireEvent.drop(targetChip, {
      dataTransfer: {
        types: ['application/x-ui-image'],
        getData: () => 'image-1',
      },
    })

    await waitFor(() => expect(placeImage).toHaveBeenCalledWith('image-1', 'module-2', null))
    expect(placeImage).not.toHaveBeenCalledWith('image-0', 'module-2', null)
  })

  it('keeps viewer navigation in the flat module order even when flow IDs differ', async () => {
    const user = userEvent.setup()
    const { repository, snapshot } = managementFixture()
    snapshot.images.push({ ...snapshot.images[0], id: 'different-flow', title: '不同流程', flowId: 'different', sequenceOrder: 3 })
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('button', { name: '查看 图片甲' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('1 / 3')
    await user.click(screen.getByRole('button', { name: '下一张' }))
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: '图片乙' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '下一张' }))
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: '不同流程' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '下一张' }))
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: '图片甲' })).toBeInTheDocument()
  })

  it('orders the flat module grid and viewer by sequence, creation time, then ID', async () => {
    const user = userEvent.setup()
    const { repository, snapshot } = managementFixture()
    snapshot.images = [
      { ...snapshot.images[0], id: 'z', title: '第三', flowId: undefined, sequenceOrder: 1, createdAt: '2026-01-02' },
      { ...snapshot.images[0], id: 'b', title: '第二', flowId: undefined, sequenceOrder: 1, createdAt: '2026-01-01' },
      { ...snapshot.images[0], id: 'a', title: '第一', flowId: undefined, sequenceOrder: 1, createdAt: '2026-01-01' },
      snapshot.images[1], snapshot.images[2],
    ]
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('button', { name: '查看 第一' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('1 / 4')
    await user.click(screen.getByRole('button', { name: '下一张' }))
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: '第二' })).toBeInTheDocument()
  })

  it('shows mutation errors without closing confirmation and blocks duplicate submissions while busy', async () => {
    const user = userEvent.setup()
    const { repository } = managementFixture()
    let rejectDelete!: (error: Error) => void
    repository.deleteImages = vi.fn(() => new Promise<MutationResult>((_resolve, reject) => { rejectDelete = reject }))
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('checkbox', { name: '选择 图片甲' }))
    await user.click(screen.getByRole('button', { name: '删除已选' }))
    await user.dblClick(screen.getByRole('button', { name: '确认删除' }))
    expect(repository.deleteImages).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '删除中…' })).toBeDisabled()
    await user.tab()
    expect(screen.getByRole('alertdialog')).toContainElement(document.activeElement as HTMLElement)
    rejectDelete(new Error('删除失败，请重试'))
    expect(await screen.findByRole('alert')).toHaveTextContent('删除失败，请重试')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: '确认删除' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('shows partial cleanup as a non-blocking warning after refresh', async () => {
    const user = userEvent.setup()
    const { repository, snapshot } = managementFixture()
    repository.deleteImages = vi.fn(async () => {
      snapshot.images = snapshot.images.slice(1)
      return { status: 'partial' as const, pendingCleanup: 2, message: '还有 2 个文件等待清理' }
    })
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('checkbox', { name: '选择 图片甲' }))
    await user.click(screen.getByRole('button', { name: '删除已选' }))
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    expect(await screen.findByRole('status')).toHaveTextContent('还有 2 个文件等待清理')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看 图片乙' })).toBeEnabled()
  })

  it.each(['demo', 'missing'] as const)('hides management controls for %s mutation availability', async (mode) => {
    const { repository } = managementFixture()
    if (mode === 'demo') Object.assign(repository, { mode: 'demo' })
    else {
      delete (repository as LibraryRepository & { placeImage?: unknown }).placeImage
      delete repository.moveImage
      delete repository.deleteImages
      delete repository.deleteGame
    }
    render(<App repository={repository} />)
    await userEvent.click(await screen.findByRole('button', { name: '查看 图片甲' }))
    expect(screen.queryByRole('button', { name: '删除图片' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除游戏' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /移动 .* 到模块或位置/ })).not.toBeInTheDocument()
  })
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
    expect(screen.queryByLabelText('序列顺序')).not.toBeInTheDocument()
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
      tags: ['弹窗', '奖励', '金币'],
    }))
  })
})

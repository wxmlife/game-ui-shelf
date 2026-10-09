import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../app/App'
import type { LibraryRepository } from '../data/libraryRepository'

function folderFile(path: string) {
  const fileName = path.split('/').at(-1) ?? path
  const file = new File(['image'], fileName, { type: 'image/png', lastModified: 123 })
  Object.defineProperty(file, 'webkitRelativePath', { value: path })
  return file
}

describe('UploadPage', () => {
  beforeEach(() => {
    window.location.hash = '#/upload'
  })

  it('allows correcting inferred metadata before submitting', async () => {
    const user = userEvent.setup()
    const submitImport = vi.fn().mockResolvedValue({ status: 'complete', uploaded: 1, failures: [] })
    const repository: LibraryRepository = {
      mode: 'cloud',
      getSnapshot: vi.fn().mockResolvedValue({ games: [], captureSets: [], modules: [], images: [] }),
      submitImport,
    }
    render(<App repository={repository} />)

    const chooser = await screen.findByLabelText('选择游戏图片文件夹')
    await user.upload(chooser, folderFile('IDOL/reward奖励-奖励详情.png'))

    expect(await screen.findByRole('heading', { name: '导入预览' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('IDOL')).toBeInTheDocument()
    const title = screen.getByLabelText('图片标题 reward奖励-奖励详情.png')
    await user.clear(title)
    await user.type(title, '首领奖励详情')
    const tags = screen.getByLabelText('标签 reward奖励-奖励详情.png')
    await user.type(tags, '弹窗, 金币')
    await user.click(screen.getByRole('button', { name: '上传 1 张图片' }))

    await waitFor(() => expect(submitImport).toHaveBeenCalledTimes(1))
    expect(submitImport.mock.calls[0][0]).toMatchObject({
      gameName: 'IDOL',
      files: [{ title: '首领奖励详情', tags: ['弹窗', '金币'] }],
    })
    expect(await screen.findByText('已完成上传 1 张图片')).toBeInTheDocument()
  })

  it('previews files in demo mode and explains why saving is unavailable', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.upload(
      await screen.findByLabelText('选择游戏图片文件夹'),
      folderFile('IDOL/home首页.png'),
    )
    await user.click(await screen.findByRole('button', { name: '检查配置并上传' }))

    expect(await screen.findByText('当前为只读演示模式')).toBeInTheDocument()
  })
})

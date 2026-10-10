import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../app/App'
import type { LibraryRepository } from '../data/libraryRepository'
import { createThumbnail } from '../features/upload/createThumbnail'
import type { ThumbnailBlob } from '../features/upload/createThumbnail'

vi.mock('../features/upload/createThumbnail', () => ({
  createThumbnail: vi.fn(async () => thumbnailBlob()),
}))

function folderFile(path: string) {
  const fileName = path.split('/').at(-1) ?? path
  const file = new File(['image'], fileName, { type: 'image/png', lastModified: 123 })
  Object.defineProperty(file, 'webkitRelativePath', { value: path })
  return file
}

function thumbnailBlob(): ThumbnailBlob {
  return Object.assign(new Blob(['thumbnail'], { type: 'image/webp' }), {
    sourceWidth: 1170,
    sourceHeight: 2532,
  })
}

describe('UploadPage', () => {
  beforeEach(() => {
    window.location.hash = '#/upload'
    vi.mocked(createThumbnail).mockReset()
    vi.mocked(createThumbnail).mockResolvedValue(thumbnailBlob())
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
    expect(tags).toHaveValue('奖励, 详情')
    await user.clear(tags)
    await user.type(tags, '弹窗, 金币')
    await user.click(screen.getByRole('button', { name: '上传 1 张图片' }))

    await waitFor(() => expect(submitImport).toHaveBeenCalledTimes(1))
    expect(submitImport.mock.calls[0][0]).toMatchObject({
      gameName: 'IDOL',
      files: [{ title: '首领奖励详情', tags: ['弹窗', '金币'], width: 1170, height: 2532 }],
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

  it('keeps only failed files after a partial upload and lists every failure', async () => {
    const user = userEvent.setup()
    const submitImport = vi.fn()
      .mockImplementationOnce(async (submission) => ({
        status: 'partial' as const,
        uploaded: 1,
        failures: [
          {
            fileId: submission.files[1].id,
            fileName: submission.files[1].originalFilename,
            message: '存储空间不足',
          },
          {
            fileId: submission.files[2].id,
            fileName: submission.files[2].originalFilename,
            message: '网络超时',
          },
        ],
        message: '部分图片上传失败',
      }))
      .mockResolvedValueOnce({ status: 'complete', uploaded: 2, failures: [] })
    const repository: LibraryRepository = {
      mode: 'cloud',
      getSnapshot: vi.fn().mockResolvedValue({ games: [], captureSets: [], modules: [], images: [] }),
      submitImport,
    }
    render(<App repository={repository} />)

    await user.upload(
      await screen.findByLabelText('选择游戏图片文件夹'),
      [
        folderFile('IDOL/home首页.png'),
        folderFile('IDOL/task任务.png'),
        folderFile('IDOL/reward奖励.png'),
      ],
    )
    await user.click(await screen.findByRole('button', { name: '上传 3 张图片' }))

    const failures = await screen.findByRole('list', { name: '上传失败文件' })
    expect(within(failures).getByText('task任务.png')).toBeInTheDocument()
    expect(within(failures).getByText(/存储空间不足/)).toBeInTheDocument()
    expect(within(failures).getByText('reward奖励.png')).toBeInTheDocument()
    expect(within(failures).getByText(/网络超时/)).toBeInTheDocument()
    expect(screen.queryByLabelText('图片标题 home首页.png')).not.toBeInTheDocument()
    expect(screen.getByLabelText('图片标题 task任务.png')).toBeInTheDocument()
    expect(screen.getByLabelText('图片标题 reward奖励.png')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '上传 2 张图片' }))
    await waitFor(() => expect(submitImport).toHaveBeenCalledTimes(2))
    expect(submitImport.mock.calls[1][0].files.map((file: { originalFilename: string }) => file.originalFilename)).toEqual([
      'task任务.png',
      'reward奖励.png',
    ])
  })

  it('generates at most three thumbnails concurrently', async () => {
    const user = userEvent.setup()
    const pending: Array<(thumbnail: ThumbnailBlob) => void> = []
    vi.mocked(createThumbnail).mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
    const submitImport = vi.fn().mockResolvedValue({ status: 'complete', uploaded: 4, failures: [] })
    const repository: LibraryRepository = {
      mode: 'cloud',
      getSnapshot: vi.fn().mockResolvedValue({ games: [], captureSets: [], modules: [], images: [] }),
      submitImport,
    }
    render(<App repository={repository} />)

    await user.upload(
      await screen.findByLabelText('选择游戏图片文件夹'),
      [
        folderFile('IDOL/home首页.png'),
        folderFile('IDOL/task任务.png'),
        folderFile('IDOL/reward奖励.png'),
        folderFile('IDOL/shop商店.png'),
      ],
    )
    await user.click(await screen.findByRole('button', { name: '上传 4 张图片' }))

    await waitFor(() => expect(createThumbnail).toHaveBeenCalled())
    expect(createThumbnail).toHaveBeenCalledTimes(3)
    pending.shift()?.(thumbnailBlob())
    await waitFor(() => expect(createThumbnail).toHaveBeenCalledTimes(4))

    pending.splice(0).forEach((resolve) => resolve(thumbnailBlob()))
    expect(await screen.findByText('已完成上传 4 张图片')).toBeInTheDocument()
  })
})

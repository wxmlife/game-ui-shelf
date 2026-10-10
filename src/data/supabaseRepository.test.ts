import { describe, expect, it, vi } from 'vitest'

import type { ImportSubmission } from './libraryRepository'
import { SupabaseLibraryRepository } from './supabaseRepository'

function session(userId = 'user-1') {
  return { data: { session: { user: { id: userId } } }, error: null }
}

interface CleanupRow { id: number; owner_id: string; bucket: string; path: string }

function mutationClient(
  initialRows: CleanupRow[] = [],
  removeFailure?: (bucket: string) => boolean,
  emptySnapshot = false,
  options: {
    removedPaths?: (paths: string[]) => string[]
    queueAckError?: boolean
    storageGate?: Promise<void>
  } = {},
) {
  const queue = [...initialRows]
  const calls: Array<{ bucket: string; paths: string[] }> = []
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
  const client = {
    auth: { getSession: vi.fn().mockResolvedValue(session()) },
    rpc,
    from: vi.fn((table: string) => {
      if (table !== 'storage_cleanup_queue') {
        if (emptySnapshot) return { select: vi.fn().mockResolvedValue({ data: [], error: null }) }
        throw new Error(`Unexpected table ${table}`)
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn((_column: string, owner: string) => ({
            gt: vi.fn((_column: string, after: number) => ({
              order: vi.fn(() => ({
                limit: vi.fn(async (count: number) => ({
                  data: queue.filter((row) => row.owner_id === owner && row.id > after).slice(0, count), error: null,
                })),
              })),
            })),
          })),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn((_column: string, owner: string) => ({
            in: vi.fn(async (_key: string, ids: number[]) => {
              if (options.queueAckError) return { data: null, error: new Error('queue unavailable') }
              for (const id of ids) {
                const index = queue.findIndex((row) => row.owner_id === owner && row.id === id)
                if (index >= 0) queue.splice(index, 1)
              }
              return { data: null, error: null }
            }),
          })),
        })),
      }
    }),
    storage: { from: vi.fn((bucket: string) => ({
      remove: vi.fn(async (paths: string[]) => {
        calls.push({ bucket, paths })
        await options.storageGate
        return removeFailure?.(bucket)
          ? { data: null, error: new Error('storage unavailable') }
          : { data: (options.removedPaths?.(paths) ?? paths).map((name) => ({ name })), error: null }
      }),
    })) },
  }
  return { client, rpc, queue, calls }
}

describe('SupabaseLibraryRepository', () => {
  it('refuses to read private data without an authenticated session', async () => {
    const client = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
    }
    const repository = new SupabaseLibraryRepository(client as never)

    await expect(repository.getSnapshot()).rejects.toThrow('请先登录')
  })

  it('maps relational rows and signs private image paths', async () => {
    const createSignedUrl = vi.fn(async (
      path: string,
      _expiresIn: number,
      options?: { download?: string | boolean },
    ) => ({
      data: {
        signedUrl: `signed://bucket/${path}${options?.download ? `?download=${encodeURIComponent(String(options.download))}` : ''}`,
      },
      error: null,
    }))
    const rows: Record<string, unknown[]> = {
      games: [{
        id: 'game-1', slug: 'idol', name: 'IDOL', aliases: ['偶像'], cover_thumbnail_path: 'user-1/game-1/cover.webp',
        cover_tone: '#112233', developer: 'Studio', platforms: ['iOS'], tags: ['模拟'], image_count: 1,
        updated_at: '2026-10-09T00:00:00Z', description: 'demo',
      }],
      capture_sets: [{ id: 'set-1', game_id: 'game-1', platform: 'iOS', version: '1.0', region: null, captured_at: null, source_url: null, note: null }],
      modules: [{ id: 'module-1', game_id: 'game-1', key: 'reward', name: '奖励', sort_order: 1 }],
      ui_images: [{
        id: 'image-1', game_id: 'game-1', capture_set_id: 'set-1', module_id: 'module-1', flow_id: 'flow-1',
        title: '奖励详情', original_filename: 'reward奖励-奖励详情.png', original_path: 'user-1/game-1/image-1/original.png',
        thumbnail_path: 'user-1/game-1/image-1/thumb.webp', width: 1170, height: 2532, sequence_order: 2,
        created_at: '2026-10-09T00:00:00Z', search_text: '奖励 弹窗', modules: { key: 'reward', name: '奖励' },
        flows: { name: '领取奖励' }, capture_sets: { platform: 'iOS', version: '1.0' },
        image_tags: [{ tags: { name: '弹窗' } }, { tags: { name: '奖励' } }],
      }],
    }
    const client = {
      auth: { getSession: vi.fn().mockResolvedValue(session()) },
      from: vi.fn((table: string) => ({
        select: vi.fn().mockResolvedValue({ data: rows[table] ?? [], error: null }),
      })),
      storage: {
        from: vi.fn((bucket: string) => ({
          createSignedUrl: vi.fn(async (path: string, expiresIn: number, options?: { download?: string | boolean }) => {
            const result = await createSignedUrl(path, expiresIn, options)
            return { data: { signedUrl: result.data.signedUrl.replace('bucket', bucket) }, error: result.error }
          }),
        })),
      },
    }
    const repository = new SupabaseLibraryRepository(client as never)

    const snapshot = await repository.getSnapshot()

    expect(snapshot.games[0]).toMatchObject({ name: 'IDOL', coverUrl: 'signed://game-ui-thumbnails/user-1/game-1/cover.webp' })
    expect(snapshot.images[0]).toMatchObject({
      moduleKey: 'reward', moduleName: '奖励', flowName: '领取奖励', tags: ['弹窗', '奖励'],
      imageUrl: 'signed://game-ui-originals/user-1/game-1/image-1/original.png',
      downloadUrl: 'signed://game-ui-originals/user-1/game-1/image-1/original.png?download=reward%E5%A5%96%E5%8A%B1-%E5%A5%96%E5%8A%B1%E8%AF%A6%E6%83%85.png',
      thumbnailUrl: 'signed://game-ui-thumbnails/user-1/game-1/image-1/thumb.webp',
    })
    expect(createSignedUrl).toHaveBeenCalledWith(
      'user-1/game-1/image-1/original.png',
      86_400,
      { download: 'reward奖励-奖励详情.png' },
    )
    expect(createSignedUrl.mock.calls.every(([, expiresIn]) => expiresIn === 86_400)).toBe(true)
  })

  it('reports per-file partial upload failures while preserving successes', async () => {
    let originalUploads = 0
    const rpc = vi.fn().mockResolvedValue({ data: 'image-1', error: null })
    const tableIds: Record<string, string> = {
      games: 'game-1', capture_sets: 'set-1', modules: 'module-1', flows: 'flow-1', ui_images: 'image-1', tags: 'tag-1',
    }
    const client = {
      auth: { getSession: vi.fn().mockResolvedValue(session()) },
      from: vi.fn((table: string) => ({
        upsert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: tableIds[table] }, error: null }) })) })),
        insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: tableIds[table] }, error: null }) })) })),
      })),
      rpc,
      storage: {
        from: vi.fn((bucket: string) => ({
          upload: vi.fn(async () => {
            if (bucket === 'game-ui-originals' && ++originalUploads === 2) return { data: null, error: new Error('storage full') }
            return { data: { path: 'ok' }, error: null }
          }),
          remove: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      },
    }
    const draft: ImportSubmission = {
      gameName: 'IDOL',
      platform: 'iOS',
      version: '1.0',
      files: ['one.png', 'two.png'].map((name, index) => ({
        id: `file-${index + 1}`,
        file: new File(['image'], name, { type: 'image/png' }),
        width: 1170,
        height: 2532,
        gameName: 'IDOL', moduleKey: 'reward', moduleName: '奖励', flowName: '领取奖励',
        title: index ? '奖励领取' : '奖励详情', tags: ['奖励'], sequenceOrder: index + 1, originalFilename: name,
      })),
    }
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.submitImport(draft)

    expect(result).toMatchObject({ status: 'partial', uploaded: 1 })
    expect(result.failures).toEqual([{ fileId: 'file-2', fileName: 'two.png', message: 'storage full' }])
    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('create_ui_image_with_tags', expect.objectContaining({
      p_width: 1170,
      p_height: 2532,
      p_tags: ['奖励'],
    }))
  })

  it('uses an ASCII storage key while preserving a Chinese original filename', async () => {
    const uploadedPaths: string[] = []
    const rpc = vi.fn().mockResolvedValue({ data: 'image-1', error: null })
    const tableIds: Record<string, string> = {
      games: 'game-1', capture_sets: 'set-1', modules: 'module-1', flows: 'flow-1',
    }
    const client = {
      auth: { getSession: vi.fn().mockResolvedValue(session()) },
      from: vi.fn((table: string) => ({
        upsert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: tableIds[table] }, error: null }) })) })),
        insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: tableIds[table] }, error: null }) })) })),
      })),
      rpc,
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async (path: string) => {
            uploadedPaths.push(path)
            return { data: { path }, error: null }
          }),
          remove: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      },
    }
    const originalFilename = '公会_总榜已解锁.jpeg'
    const draft: ImportSubmission = {
      gameName: 'IDOL Empire',
      platform: 'iOS',
      version: '',
      files: [{
        id: 'file-1',
        file: new File(['image'], originalFilename, { type: 'image/jpeg' }),
        gameName: 'IDOL Empire',
        moduleKey: '公会',
        moduleName: '公会',
        flowName: '总榜已解锁',
        title: '总榜已解锁',
        tags: ['公会'],
        sequenceOrder: 1,
        originalFilename,
      }],
    }
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.submitImport(draft)

    expect(result.status).toBe('complete')
    expect(uploadedPaths).toHaveLength(1)
    expect(uploadedPaths[0]).toMatch(/^[\x20-\x7e]+$/)
    expect(uploadedPaths[0]).toMatch(/\/original\.jpeg$/)
    expect(rpc).toHaveBeenCalledWith('create_ui_image_with_tags', expect.objectContaining({
      p_original_filename: originalFilename,
      p_original_path: uploadedPaths[0],
    }))
  })

  it('uses one transactional RPC when updating image metadata and tags', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const client = {
      auth: { getSession: vi.fn().mockResolvedValue(session()) },
      rpc,
    }
    const repository = new SupabaseLibraryRepository(client as never)

    await repository.updateImageMetadata('image-1', {
      moduleId: 'module-1',
      title: '奖励领取成功',
      flowName: '领取奖励',
      sequenceOrder: 3,
      tags: ['奖励', '反馈', '奖励'],
    })

    expect(rpc).toHaveBeenCalledWith('update_ui_image_metadata_with_tags', {
      p_image_id: 'image-1',
      p_module_id: 'module-1',
      p_title: '奖励领取成功',
      p_flow_name: '领取奖励',
      p_sequence_order: 3,
      p_search_text: '奖励领取成功 领取奖励 奖励 反馈',
      p_tags: ['奖励', '反馈'],
    })
  })

  it('moves an image through one atomic RPC without touching Storage', async () => {
    const { client, rpc, calls } = mutationClient()
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.moveImage('image-1', 'module-2')

    expect(result.status).toBe('complete')
    expect(rpc).toHaveBeenCalledExactlyOnceWith('move_ui_image_to_module', {
      p_image_id: 'image-1', p_target_module_id: 'module-2',
    })
    expect(calls).toEqual([])
  })

  it('deletes a single image with one transactional RPC', async () => {
    const { client, rpc } = mutationClient()
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.deleteImages(['image-1'])

    expect(result.status).toBe('complete')
    expect(rpc).toHaveBeenCalledExactlyOnceWith('delete_ui_images', { p_image_ids: ['image-1'] })
  })

  it('deletes a cross-module batch in one transaction and groups Storage cleanup by bucket', async () => {
    const { client, rpc, queue, calls } = mutationClient([
      { id: 1, owner_id: 'user-1', bucket: 'game-ui-originals', path: 'user-1/game-1/a/original.png' },
      { id: 2, owner_id: 'user-1', bucket: 'game-ui-thumbnails', path: 'user-1/game-1/a/thumb.webp' },
      { id: 3, owner_id: 'user-1', bucket: 'game-ui-originals', path: 'user-1/game-1/b/original.png' },
    ])
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.deleteImages(['image-a', 'image-b'])

    expect(result).toMatchObject({ status: 'complete', pendingCleanup: 0 })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('delete_ui_images', { p_image_ids: ['image-a', 'image-b'] })
    expect(calls).toEqual([
      { bucket: 'game-ui-originals', paths: ['user-1/game-1/a/original.png', 'user-1/game-1/b/original.png'] },
      { bucket: 'game-ui-thumbnails', paths: ['user-1/game-1/a/thumb.webp'] },
    ])
    expect(queue).toEqual([])
  })

  it('keeps failed Storage objects queued after metadata deletion', async () => {
    const { client, rpc, queue } = mutationClient([
      { id: 1, owner_id: 'user-1', bucket: 'game-ui-originals', path: 'user-1/game-1/a/original.png' },
      { id: 2, owner_id: 'user-1', bucket: 'game-ui-thumbnails', path: 'user-1/game-1/a/thumb.webp' },
    ], (bucket) => bucket === 'game-ui-thumbnails')
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.deleteImages(['image-a'])

    expect(rpc).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ status: 'partial', pendingCleanup: 1 })
    expect(queue.map((row) => row.id)).toEqual([2])
  })

  it('retains all cleanup tasks when Storage returns no confirmed paths', async () => {
    const { client, queue } = mutationClient([
      { id: 1, owner_id: 'user-1', bucket: 'game-ui-originals', path: 'user-1/game-1/a/original.png' },
    ], undefined, false, { removedPaths: () => [] })
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.deleteImages(['image-a'])

    expect(result).toMatchObject({ status: 'partial', pendingCleanup: 1 })
    expect(queue.map((row) => row.id)).toEqual([1])
  })

  it('acknowledges only the paths explicitly returned by Storage', async () => {
    const { client, queue } = mutationClient([
      { id: 1, owner_id: 'user-1', bucket: 'game-ui-originals', path: 'user-1/game-1/a/original.png' },
      { id: 2, owner_id: 'user-1', bucket: 'game-ui-originals', path: 'user-1/game-1/b/original.png' },
    ], undefined, false, { removedPaths: (paths) => [paths[0]] })
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.deleteImages(['image-a', 'image-b'])

    expect(result).toMatchObject({ status: 'partial', pendingCleanup: 1 })
    expect(queue.map((row) => row.id)).toEqual([2])
  })

  it('retains confirmed Storage paths when queue acknowledgement fails', async () => {
    const { client, queue } = mutationClient([
      { id: 1, owner_id: 'user-1', bucket: 'game-ui-originals', path: 'user-1/game-1/a/original.png' },
    ], undefined, false, { queueAckError: true })
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.deleteImages(['image-a'])

    expect(result).toMatchObject({ status: 'partial', pendingCleanup: 1 })
    expect(queue.map((row) => row.id)).toEqual([1])
  })

  it('does not call the delete RPC for an empty selection', async () => {
    const { client, rpc, calls } = mutationClient()
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.deleteImages([])

    expect(result.status).toBe('complete')
    expect(rpc).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('deletes a game through one transactional RPC and cleans its cover', async () => {
    const { client, rpc, queue } = mutationClient([
      { id: 1, owner_id: 'user-1', bucket: 'game-ui-thumbnails', path: 'user-1/game-1/cover.webp' },
    ])
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.deleteGame('game-1')

    expect(result.status).toBe('complete')
    expect(rpc).toHaveBeenCalledExactlyOnceWith('delete_game', { p_game_id: 'game-1' })
    expect(queue).toEqual([])
  })

  it('still loads a snapshot when queued Storage cleanup fails', async () => {
    const { client, calls, queue } = mutationClient([
      { id: 1, owner_id: 'user-1', bucket: 'game-ui-originals', path: 'user-1/game-1/a/original.png' },
    ], () => true, true)
    const repository = new SupabaseLibraryRepository(client as never)

    const snapshot = await repository.getSnapshot()

    expect(snapshot).toEqual({ games: [], modules: [], images: [], captureSets: [] })
    expect(calls).toEqual([{ bucket: 'game-ui-originals', paths: ['user-1/game-1/a/original.png'] }])
    expect(queue).toHaveLength(1)
  })

  it('returns snapshots while one background cleanup is still pending', async () => {
    let releaseStorage!: () => void
    const storageGate = new Promise<void>((resolve) => { releaseStorage = resolve })
    const { client, calls, queue } = mutationClient([
      { id: 1, owner_id: 'user-1', bucket: 'game-ui-originals', path: 'user-1/game-1/a/original.png' },
    ], undefined, true, { storageGate })
    const repository = new SupabaseLibraryRepository(client as never)
    const snapshots = [repository.getSnapshot(), repository.getSnapshot()]
    let timer: ReturnType<typeof setTimeout> | undefined

    try {
      await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0))
      const result = await Promise.race([
        Promise.all(snapshots).then(() => 'resolved'),
        new Promise<string>((resolve) => { timer = setTimeout(() => resolve('blocked'), 100) }),
      ])
      expect(result).toBe('resolved')
      expect(calls).toHaveLength(1)
    } finally {
      if (timer) clearTimeout(timer)
      releaseStorage()
      await Promise.allSettled(snapshots)
      await vi.waitFor(() => expect(queue).toHaveLength(0))
    }
  })
})

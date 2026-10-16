import { describe, expect, it, vi } from 'vitest'

import type { ImportSubmission } from './libraryRepository'
import { SupabaseLibraryRepository } from './supabaseRepository'

function session(userId = 'user-1') {
  return { data: { session: { user: { id: userId } } }, error: null }
}

function fingerprintQuery(rows: Array<{ fingerprint: string }> = []) {
  const query = {
    eq: vi.fn(),
    in: vi.fn().mockResolvedValue({ data: rows, error: null }),
  }
  query.eq.mockReturnValue(query)
  return { select: vi.fn(() => query) }
}

interface CleanupRow { id: number; owner_id: string; bucket: string; path: string }

function mutationClient(
  initialRows: CleanupRow[] = [],
  removeFailure?: (bucket: string) => boolean,
  emptySnapshot = false,
  options: {
    removedPaths?: (paths: string[]) => string[]
    queueAckError?: boolean
    queueAckFailures?: number
    removeDeletesBeforeError?: boolean
    recreateRemovedPaths?: boolean
    storageGate?: Promise<void>
    queueReadLimit?: number
    enqueueAfterFirstRemove?: CleanupRow
  } = {},
) {
  const queue = [...initialRows]
  const storageObjects = new Set(initialRows.map((row) => `${row.bucket}:${row.path}`))
  let queueAckFailures = options.queueAckFailures ?? (options.queueAckError ? Number.POSITIVE_INFINITY : 0)
  const calls: Array<{ bucket: string; paths: string[] }> = []
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name !== 'acknowledge_storage_cleanup') return { data: null, error: null }
    if (queueAckFailures > 0) {
      queueAckFailures -= 1
      return { data: null, error: new Error('queue unavailable') }
    }
    const ids = args.p_queue_ids as number[]
    const confirmed: number[] = []
    for (const id of ids) {
      const index = queue.findIndex((row) => row.owner_id === 'user-1' && row.id === id)
      if (index >= 0 && !storageObjects.has(`${queue[index].bucket}:${queue[index].path}`)) {
        confirmed.push(id)
        queue.splice(index, 1)
      }
    }
    return { data: confirmed, error: null }
  })
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
          eq: vi.fn((_column: string, owner: string) => {
            const ownedRows = () => queue.filter((row) => row.owner_id === owner)
            const orderedPage = (rows: CleanupRow[], ascending: boolean, count: number) => ({
              data: [...rows]
                .sort((left, right) => ascending ? left.id - right.id : right.id - left.id)
                .slice(0, Math.min(count, options.queueReadLimit ?? count)),
              error: null,
            })
            return {
              order: vi.fn((_column: string, orderOptions: { ascending: boolean }) => ({
                limit: vi.fn(async (count: number) => orderedPage(ownedRows(), orderOptions.ascending, count)),
              })),
              gt: vi.fn((_column: string, after: number) => ({
                lte: vi.fn((_column: string, highWatermark: number) => ({
                  order: vi.fn((_column: string, orderOptions: { ascending: boolean }) => ({
                    limit: vi.fn(async (count: number) => orderedPage(
                      ownedRows().filter((row) => row.id > after && row.id <= highWatermark),
                      orderOptions.ascending,
                      count,
                    )),
                  })),
                })),
              })),
              in: vi.fn(async (_column: string, ids: number[]) => ({
                data: ownedRows().filter((row) => ids.includes(row.id)).map((row) => ({ id: row.id })),
                error: null,
              })),
            }
          }),
        })),
      }
    }),
    storage: { from: vi.fn((bucket: string) => ({
      remove: vi.fn(async (paths: string[]) => {
        calls.push({ bucket, paths })
        await options.storageGate
        if (calls.length === 1 && options.enqueueAfterFirstRemove) {
          queue.push(options.enqueueAfterFirstRemove)
          storageObjects.add(`${options.enqueueAfterFirstRemove.bucket}:${options.enqueueAfterFirstRemove.path}`)
        }
        if (removeFailure?.(bucket)) {
          if (options.removeDeletesBeforeError) {
            for (const path of paths) storageObjects.delete(`${bucket}:${path}`)
          }
          return { data: null, error: new Error('storage unavailable') }
        }
        const removedPaths = (options.removedPaths?.(paths) ?? paths)
          .filter((path) => storageObjects.has(`${bucket}:${path}`))
        for (const path of removedPaths) storageObjects.delete(`${bucket}:${path}`)
        if (options.recreateRemovedPaths) {
          for (const path of removedPaths) storageObjects.add(`${bucket}:${path}`)
        }
        return { data: removedPaths.map((name) => ({ name })), error: null }
      }),
    })) },
  }
  return { client, rpc, queue, calls, storageObjects }
}

function coverClient(options: {
  image?: { id: string; owner_id: string; game_id: string; thumbnail_path: string | null }
  copyError?: Error
  copyThrows?: Error
  copyCreatesBeforeFailure?: boolean
  rpcError?: { message: string; code: string }
  loseRpcResponse?: boolean
  unknownRpcFailure?: boolean
  coverReadError?: boolean
  cleanupFails?: boolean
  queueWriteFails?: boolean
} = {}) {
  const fixture = mutationClient([], () => options.cleanupFails ?? false)
  const image = options.image ?? {
    id: 'image-1', owner_id: 'user-1', game_id: 'game-1', thumbnail_path: 'user-1/game-1/image-1/thumbnail.webp',
  }
  const game = {
    id: 'game-1', owner_id: 'user-1',
    cover_thumbnail_path: 'user-1/game-1/covers/old/thumbnail.webp',
    cover_original_path: 'user-1/game-1/covers/old/original.png' as string | null,
  }
  for (const [bucket, path] of [
    ['game-ui-originals', game.cover_original_path],
    ['game-ui-thumbnails', game.cover_thumbnail_path],
    ['game-ui-thumbnails', image.thumbnail_path],
  ]) {
    if (path) fixture.storageObjects.add(`${bucket}:${path}`)
  }
  const copies: Array<{ bucket: string; from: string; to: string }> = []
  const cleanupFrom = fixture.client.from
  const cleanupStorageFrom = fixture.client.storage.from
  const cleanupRpc = fixture.rpc
  const client = {
    ...fixture.client,
    from: vi.fn((table: string) => {
      if (table === 'storage_cleanup_queue') return {
        ...cleanupFrom(table),
        upsert: vi.fn(async (row: Omit<CleanupRow, 'id'>, settings: { onConflict: string; ignoreDuplicates: boolean }) => {
          if (options.queueWriteFails) return { data: null, error: new Error('queue unavailable') }
          if (settings.onConflict !== 'owner_id,bucket,path' || !settings.ignoreDuplicates) {
            return { data: null, error: new Error('Queue update privilege is not granted') }
          }
          if (!fixture.queue.some((item) => item.owner_id === row.owner_id && item.bucket === row.bucket && item.path === row.path)) {
            fixture.queue.push({ ...row, id: fixture.queue.reduce((max, item) => Math.max(max, item.id), 0) + 1 })
          }
          return { data: null, error: null }
        }),
      }
      if (table !== 'ui_images' && table !== 'games') throw new Error(`Unexpected table ${table}`)
      const row = table === 'ui_images' ? image : game
      const filters: Record<string, unknown> = {}
      const query = {
        eq: vi.fn((column: string, value: unknown) => { filters[column] = value; return query }),
        maybeSingle: vi.fn(async () => ({
          data: Object.entries(filters).every(([key, value]) => row[key as keyof typeof row] === value) ? { ...row } : null,
          error: table === 'games' && options.coverReadError ? new Error('read unavailable') : null,
        })),
      }
      return { select: vi.fn(() => query) }
    }),
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name !== 'set_game_cover_from_image') return cleanupRpc(name, args)
      if (options.rpcError) return { data: null, error: options.rpcError }
      if (options.unknownRpcFailure) throw new Error('connection lost')
      const newPath = args.p_cover_thumbnail_path as string
      if (!fixture.storageObjects.has(`game-ui-thumbnails:${newPath}`)) throw new Error('Cover was not copied before the RPC')
      const nextId = fixture.queue.reduce((max, row) => Math.max(max, row.id), 0) + 1
      fixture.queue.push({ id: nextId, owner_id: 'user-1', bucket: 'game-ui-thumbnails', path: game.cover_thumbnail_path })
      if (game.cover_original_path) {
        fixture.queue.push({ id: nextId + 1, owner_id: 'user-1', bucket: 'game-ui-originals', path: game.cover_original_path })
      }
      game.cover_thumbnail_path = newPath
      game.cover_original_path = null
      if (options.loseRpcResponse) throw new Error('connection lost')
      return { data: null, error: null }
    }),
    storage: { from: vi.fn((bucket: string) => ({
      ...cleanupStorageFrom(bucket),
      copy: vi.fn(async (from: string, to: string) => {
        copies.push({ bucket, from, to })
        if (options.copyCreatesBeforeFailure) fixture.storageObjects.add(`${bucket}:${to}`)
        if (options.copyThrows) throw options.copyThrows
        if (options.copyError) return { data: null, error: options.copyError }
        if (!fixture.storageObjects.has(`${bucket}:${from}`)) return { data: null, error: new Error('Source not found') }
        if (fixture.storageObjects.has(`${bucket}:${to}`)) return { data: null, error: new Error('Destination exists') }
        fixture.storageObjects.add(`${bucket}:${to}`)
        return { data: { path: to }, error: null }
      }),
    })) },
  }
  return { ...fixture, client, game, image, copies }
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
      from: vi.fn((table: string) => table === 'ui_images'
        ? fingerprintQuery()
        : ({
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

  it('skips images that already exist in the target game before uploading storage objects', async () => {
    const file = new File(['image'], 'home首页.png', { type: 'image/png', lastModified: 123 })
    const fingerprint = `${file.size}:${file.lastModified}:${file.name.toLocaleLowerCase()}`
    const uploads = vi.fn().mockResolvedValue({ data: { path: 'unexpected' }, error: null })
    const rpc = vi.fn().mockResolvedValue({ data: 'unexpected', error: null })
    const inserts = vi.fn()
    const duplicateQuery = {
      eq: vi.fn(),
      in: vi.fn().mockResolvedValue({ data: [{ fingerprint }], error: null }),
    }
    duplicateQuery.eq.mockReturnValue(duplicateQuery)
    const client = {
      auth: { getSession: vi.fn().mockResolvedValue(session()) },
      from: vi.fn((table: string) => {
        if (table === 'games') return {
          upsert: vi.fn(() => ({
            select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: 'game-1' }, error: null }) })),
          })),
        }
        if (table === 'ui_images') return { select: vi.fn(() => duplicateQuery) }
        return {
          insert: inserts,
          upsert: vi.fn(() => ({
            select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: `${table}-1` }, error: null }) })),
          })),
        }
      }),
      rpc,
      storage: { from: vi.fn(() => ({ upload: uploads, remove: vi.fn() })) },
    }
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.submitImport({
      gameName: 'IDOL',
      files: [{
        id: 'file-1', file, gameName: 'IDOL', moduleKey: 'home', moduleName: '首页',
        title: '首页', tags: ['首页'], sequenceOrder: 1, originalFilename: file.name,
      }],
    })

    expect(result).toMatchObject({
      status: 'complete',
      uploaded: 0,
      skipped: 1,
      failures: [],
      message: '这 1 张图片已在当前游戏中，已跳过重复项',
    })
    expect(uploads).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(inserts).not.toHaveBeenCalled()
    expect(duplicateQuery.eq).toHaveBeenNthCalledWith(1, 'owner_id', 'user-1')
    expect(duplicateQuery.eq).toHaveBeenNthCalledWith(2, 'game_id', 'game-1')
    expect(duplicateQuery.in).toHaveBeenCalledWith('fingerprint', [fingerprint])
  })

  it('uploads only new images when a batch also contains existing images', async () => {
    const existingFile = new File(['existing'], 'home首页.png', { type: 'image/png', lastModified: 123 })
    const newFile = new File(['new'], 'task任务.png', { type: 'image/png', lastModified: 456 })
    const existingFingerprint = `${existingFile.size}:${existingFile.lastModified}:${existingFile.name.toLocaleLowerCase()}`
    const existingQuery = fingerprintQuery([{ fingerprint: existingFingerprint }])
    const uploads = vi.fn().mockResolvedValue({ data: { path: 'ok' }, error: null })
    const rpc = vi.fn().mockResolvedValue({ data: 'image-2', error: null })
    const tableIds: Record<string, string> = {
      games: 'game-1', capture_sets: 'set-1', modules: 'module-1', flows: 'flow-1',
    }
    const client = {
      auth: { getSession: vi.fn().mockResolvedValue(session()) },
      from: vi.fn((table: string) => table === 'ui_images'
        ? existingQuery
        : ({
            upsert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: tableIds[table] }, error: null }) })) })),
            insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: tableIds[table] }, error: null }) })) })),
          })),
      rpc,
      storage: { from: vi.fn(() => ({ upload: uploads, remove: vi.fn().mockResolvedValue({ data: [], error: null }) })) },
    }
    const repository = new SupabaseLibraryRepository(client as never)
    const makeSubmissionFile = (file: File, index: number) => ({
      id: `file-${index}`,
      file,
      gameName: 'IDOL',
      moduleKey: index === 1 ? 'home' : 'task',
      moduleName: index === 1 ? '首页' : '任务',
      title: index === 1 ? '首页' : '任务',
      tags: [index === 1 ? '首页' : '任务'],
      sequenceOrder: index,
      originalFilename: file.name,
    })

    const result = await repository.submitImport({
      gameName: 'IDOL',
      files: [makeSubmissionFile(existingFile, 1), makeSubmissionFile(newFile, 2)],
    })

    expect(result).toMatchObject({
      status: 'complete', uploaded: 1, skipped: 1, failures: [],
      message: '已上传 1 张图片，另有 1 张已存在并跳过',
    })
    expect(uploads).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('create_ui_image_with_tags', expect.objectContaining({
      p_original_filename: 'task任务.png',
    }))
  })

  it('retries an unconfirmed metadata response without deleting uploaded files', async () => {
    const rpc = vi.fn()
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({ data: 'image-1', error: null })
    const remove = vi.fn().mockResolvedValue({ data: [], error: null })
    const tableIds: Record<string, string> = {
      games: 'game-1', capture_sets: 'set-1', modules: 'module-1',
    }
    const client = {
      auth: { getSession: vi.fn().mockResolvedValue(session()) },
      from: vi.fn((table: string) => table === 'ui_images'
        ? fingerprintQuery()
        : ({
            upsert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: tableIds[table] }, error: null }) })) })),
            insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: tableIds[table] }, error: null }) })) })),
          })),
      rpc,
      storage: { from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ data: { path: 'ok' }, error: null }),
        remove,
      })) },
    }
    const file = new File(['image'], 'home首页.png', { type: 'image/png', lastModified: 123 })
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.submitImport({
      gameName: 'IDOL',
      files: [{
        id: 'file-1', file, gameName: 'IDOL', moduleKey: 'home', moduleName: '首页',
        title: '首页', tags: ['首页'], sequenceOrder: 1, originalFilename: file.name,
      }],
    })

    expect(result).toMatchObject({ status: 'complete', uploaded: 1, failures: [] })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[1][1]).toEqual(rpc.mock.calls[0][1])
    expect(remove).not.toHaveBeenCalled()
  })

  it('preserves uploaded files when metadata remains unconfirmed after retry', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('connection lost'))
    const remove = vi.fn().mockResolvedValue({ data: [], error: null })
    const tableIds: Record<string, string> = {
      games: 'game-1', capture_sets: 'set-1', modules: 'module-1',
    }
    const client = {
      auth: { getSession: vi.fn().mockResolvedValue(session()) },
      from: vi.fn((table: string) => table === 'ui_images'
        ? fingerprintQuery()
        : ({
            upsert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: tableIds[table] }, error: null }) })) })),
            insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: tableIds[table] }, error: null }) })) })),
          })),
      rpc,
      storage: { from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ data: { path: 'ok' }, error: null }),
        remove,
      })) },
    }
    const file = new File(['image'], 'home首页.png', { type: 'image/png', lastModified: 123 })
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.submitImport({
      gameName: 'IDOL',
      files: [{
        id: 'file-1', file, gameName: 'IDOL', moduleKey: 'home', moduleName: '首页',
        title: '首页', tags: ['首页'], sequenceOrder: 1, originalFilename: file.name,
      }],
    })

    expect(result).toMatchObject({ status: 'partial', uploaded: 0 })
    expect(result.failures[0]?.message).toContain('上传结果未确认')
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(remove).not.toHaveBeenCalled()
  })

  it('uses an ASCII storage key while preserving a Chinese original filename', async () => {
    const uploadedPaths: string[] = []
    const rpc = vi.fn().mockResolvedValue({ data: 'image-1', error: null })
    const tableIds: Record<string, string> = {
      games: 'game-1', capture_sets: 'set-1', modules: 'module-1', flows: 'flow-1',
    }
    const client = {
      auth: { getSession: vi.fn().mockResolvedValue(session()) },
      from: vi.fn((table: string) => table === 'ui_images'
        ? fingerprintQuery()
        : ({
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

  it('copies an existing thumbnail into an independent cover before the atomic update and cleans old covers', async () => {
    const { client, copies, game, image, storageObjects, queue } = coverClient()
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.setGameCoverFromImage('game-1', 'image-1')

    expect(result).toEqual({ status: 'complete', pendingCleanup: 0 })
    expect(copies).toEqual([{
      bucket: 'game-ui-thumbnails', from: 'user-1/game-1/image-1/thumbnail.webp',
      to: expect.stringMatching(/^user-1\/game-1\/covers\/[^/]+\/thumbnail\.webp$/),
    }])
    expect(client.rpc).toHaveBeenCalledWith('set_game_cover_from_image', {
      p_game_id: 'game-1', p_image_id: 'image-1', p_cover_thumbnail_path: copies[0].to,
    })
    expect(game.cover_original_path).toBeNull()
    expect(game.cover_thumbnail_path).toBe(copies[0].to)
    expect(queue).toEqual([])
    expect(storageObjects).toEqual(new Set([
      `game-ui-thumbnails:${image.thumbnail_path}`,
      `game-ui-thumbnails:${copies[0].to}`,
    ]))
  })

  it('uses a fresh cover path for each replacement and never removes the source screenshot', async () => {
    const { client, copies, image, storageObjects } = coverClient()
    const repository = new SupabaseLibraryRepository(client as never)

    await repository.setGameCoverFromImage('game-1', 'image-1')
    await repository.setGameCoverFromImage('game-1', 'image-1')

    expect(copies).toHaveLength(2)
    expect(copies[0].to).not.toBe(copies[1].to)
    expect(storageObjects).toEqual(new Set([
      `game-ui-thumbnails:${image.thumbnail_path}`, `game-ui-thumbnails:${copies[1].to}`,
    ]))
  })

  it.each([
    { owner_id: 'user-2', game_id: 'game-1' },
    { owner_id: 'user-1', game_id: 'game-2' },
  ])('rejects an image outside the authenticated game before copying: %j', async (scope) => {
    const { client, copies } = coverClient({
      image: { id: 'image-1', ...scope, thumbnail_path: `${scope.owner_id}/${scope.game_id}/image-1/thumbnail.webp` },
    })
    const repository = new SupabaseLibraryRepository(client as never)

    await expect(repository.setGameCoverFromImage('game-1', 'image-1')).rejects.toThrow(/图片不存在|当前游戏/)

    expect(copies).toEqual([])
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('rejects a screenshot without a thumbnail with an actionable error', async () => {
    const { client, copies } = coverClient({
      image: { id: 'image-1', owner_id: 'user-1', game_id: 'game-1', thumbnail_path: null },
    })
    const repository = new SupabaseLibraryRepository(client as never)

    await expect(repository.setGameCoverFromImage('game-1', 'image-1')).rejects.toThrow(/没有缩略图/)

    expect(copies).toEqual([])
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('does not change metadata or remove existing covers when the copy fails', async () => {
    const { client, game, calls } = coverClient({ copyError: new Error('storage full') })
    const repository = new SupabaseLibraryRepository(client as never)

    await expect(repository.setGameCoverFromImage('game-1', 'image-1')).rejects.toThrow('storage full')

    expect(client.rpc).not.toHaveBeenCalled()
    expect(game.cover_thumbnail_path).toBe('user-1/game-1/covers/old/thumbnail.webp')
    expect(calls).toEqual([])
  })

  it.each([
    ['returns an error', { copyError: new Error('copy response failed') }],
    ['throws', { copyThrows: new Error('copy connection failed') }],
  ])('durably queues the unique cover path without draining when Storage copy %s', async (_case, failure) => {
    const { client, copies, queue, calls, storageObjects } = coverClient({
      ...failure, copyCreatesBeforeFailure: true,
    })
    const repository = new SupabaseLibraryRepository(client as never)

    await expect(repository.setGameCoverFromImage('game-1', 'image-1')).rejects.toThrow(/copy (response|connection) failed/)

    expect(client.rpc).not.toHaveBeenCalledWith('set_game_cover_from_image', expect.anything())
    expect(queue).toEqual([{
      id: 1, owner_id: 'user-1', bucket: 'game-ui-thumbnails', path: copies[0].to,
    }])
    expect(calls).toEqual([])
    expect(storageObjects.has(`game-ui-thumbnails:${copies[0].to}`)).toBe(true)
  })

  it('compensates only the new copy when the database rejects the cover change', async () => {
    const { client, copies, game, calls, storageObjects } = coverClient({ rpcError: { message: 'Image not found', code: 'P0002' } })
    const repository = new SupabaseLibraryRepository(client as never)

    await expect(repository.setGameCoverFromImage('game-1', 'image-1')).rejects.toMatchObject({ message: 'Image not found' })

    expect(calls).toEqual([{ bucket: 'game-ui-thumbnails', paths: [copies[0].to] }])
    expect(game.cover_thumbnail_path).toBe('user-1/game-1/covers/old/thumbnail.webp')
    expect(storageObjects.has(`game-ui-thumbnails:${copies[0].to}`)).toBe(false)
    expect(storageObjects.has('game-ui-thumbnails:user-1/game-1/image-1/thumbnail.webp')).toBe(true)
  })

  it('treats a PGRST3xx RPC error as a confirmed rejection and compensates the new copy', async () => {
    const { client, copies, queue, calls, storageObjects } = coverClient({
      rpcError: { message: 'JWT expired', code: 'PGRST301' },
    })
    const repository = new SupabaseLibraryRepository(client as never)

    await expect(repository.setGameCoverFromImage('game-1', 'image-1')).rejects.toMatchObject({
      message: 'JWT expired', code: 'PGRST301',
    })

    expect(calls).toEqual([{ bucket: 'game-ui-thumbnails', paths: [copies[0].to] }])
    expect(queue).toEqual([])
    expect(storageObjects.has(`game-ui-thumbnails:${copies[0].to}`)).toBe(false)
  })

  it('preserves the new cover and returns a cover-specific partial result when old-cover cleanup fails', async () => {
    const { client, copies, game, storageObjects, queue } = coverClient({ cleanupFails: true })
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.setGameCoverFromImage('game-1', 'image-1')

    expect(result).toMatchObject({ status: 'partial', pendingCleanup: 2, message: expect.stringContaining('封面已更新') })
    expect(game.cover_thumbnail_path).toBe(copies[0].to)
    expect(storageObjects.has(`game-ui-thumbnails:${copies[0].to}`)).toBe(true)
    expect(queue).toHaveLength(2)
    expect(queue.every((row) => row.path !== copies[0].to)).toBe(true)
  })

  it('durably queues a rejected cover copy when compensating Storage removal fails', async () => {
    const { client, copies, queue, game } = coverClient({
      rpcError: { message: 'Image not found', code: 'P0002' }, cleanupFails: true,
    })
    const repository = new SupabaseLibraryRepository(client as never)

    await expect(repository.setGameCoverFromImage('game-1', 'image-1')).rejects.toMatchObject({ message: 'Image not found' })

    expect(game.cover_thumbnail_path).toBe('user-1/game-1/covers/old/thumbnail.webp')
    expect(queue).toEqual([{
      id: 1, owner_id: 'user-1', bucket: 'game-ui-thumbnails', path: copies[0].to,
    }])
  })

  it('falls back to direct compensation when a rejected cover copy cannot be queued', async () => {
    const { client, copies, queue, storageObjects } = coverClient({
      rpcError: { message: 'Image not found', code: 'P0002' }, queueWriteFails: true,
    })
    const repository = new SupabaseLibraryRepository(client as never)

    await expect(repository.setGameCoverFromImage('game-1', 'image-1')).rejects.toMatchObject({ message: 'Image not found' })

    expect(queue).toEqual([])
    expect(storageObjects.has(`game-ui-thumbnails:${copies[0].to}`)).toBe(false)
  })

  it('reports an uncompensated copy if both durable queueing and direct removal fail', async () => {
    const { client } = coverClient({
      rpcError: { message: 'Image not found', code: 'P0002' }, queueWriteFails: true, cleanupFails: true,
    })
    const repository = new SupabaseLibraryRepository(client as never)

    await expect(repository.setGameCoverFromImage('game-1', 'image-1')).rejects.toThrow(/Image not found.*副本清理未完成/)
  })

  it('does not delete an already committed cover when its RPC response is lost', async () => {
    const { client, copies, game, storageObjects } = coverClient({ loseRpcResponse: true })
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.setGameCoverFromImage('game-1', 'image-1')

    expect(result.status).toBe('complete')
    expect(game.cover_thumbnail_path).toBe(copies[0].to)
    expect(storageObjects.has(`game-ui-thumbnails:${copies[0].to}`)).toBe(true)
  })

  it.each([false, true])('keeps an unconfirmed copy rather than risk deleting a late commit (cover read fails: %s)', async (coverReadError) => {
    const { client, copies, calls, storageObjects } = coverClient({ unknownRpcFailure: true, coverReadError })
    const repository = new SupabaseLibraryRepository(client as never)

    await expect(repository.setGameCoverFromImage('game-1', 'image-1')).rejects.toThrow(/未确认.*重试/)

    expect(calls).toEqual([])
    expect(storageObjects.has(`game-ui-thumbnails:${copies[0].to}`)).toBe(true)
  })

  it('refuses to set a cover without an authenticated session', async () => {
    const { client, copies } = coverClient()
    client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null } as never)
    const repository = new SupabaseLibraryRepository(client as never)

    await expect(repository.setGameCoverFromImage('game-1', 'image-1')).rejects.toThrow('请先登录')

    expect(copies).toEqual([])
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('rejects a thumbnail path outside its owner and game even if the row belongs to this game', async () => {
    const { client, copies } = coverClient({
      image: { id: 'image-1', owner_id: 'user-1', game_id: 'game-1', thumbnail_path: 'user-1/game-2/image-2/thumbnail.webp' },
    })
    const repository = new SupabaseLibraryRepository(client as never)

    await expect(repository.setGameCoverFromImage('game-1', 'image-1')).rejects.toThrow(/缩略图路径/)

    expect(copies).toEqual([])
    expect(client.rpc).not.toHaveBeenCalled()
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
    expect(rpc.mock.calls).toEqual([
      ['delete_ui_images', { p_image_ids: ['image-a', 'image-b'] }],
      ['acknowledge_storage_cleanup', { p_queue_ids: [1, 3] }],
      ['acknowledge_storage_cleanup', { p_queue_ids: [2] }],
    ])
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

    expect(rpc.mock.calls).toEqual([
      ['delete_ui_images', { p_image_ids: ['image-a'] }],
      ['acknowledge_storage_cleanup', { p_queue_ids: [1] }],
      ['acknowledge_storage_cleanup', { p_queue_ids: [2] }],
    ])
    expect(result).toMatchObject({ status: 'partial', pendingCleanup: 1 })
    expect(queue.map((row) => row.id)).toEqual([2])
  })

  it('acknowledges an object proven absent even when Storage reports an error after deleting it', async () => {
    const { client, queue, rpc } = mutationClient([
      { id: 1, owner_id: 'user-1', bucket: 'game-ui-originals', path: 'user-1/game-1/a/original.png' },
    ], () => true, false, { removeDeletesBeforeError: true })
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.deleteImages(['image-a'])

    expect(result).toMatchObject({ status: 'complete', pendingCleanup: 0 })
    expect(queue).toEqual([])
    expect(rpc).toHaveBeenCalledWith('acknowledge_storage_cleanup', { p_queue_ids: [1] })
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

  it('keeps a cleanup task when the same Storage path exists again before acknowledgement', async () => {
    const { client, queue } = mutationClient([
      { id: 1, owner_id: 'user-1', bucket: 'game-ui-originals', path: 'user-1/game-1/a/original.png' },
    ], undefined, false, { recreateRemovedPaths: true })
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.deleteImages(['image-a'])

    expect(result).toMatchObject({ status: 'partial', pendingCleanup: 1 })
    expect(queue.map((row) => row.id)).toEqual([1])
  })

  it('never submits another owner\'s queued cleanup ID for acknowledgement', async () => {
    const { client, queue, rpc } = mutationClient([
      { id: 1, owner_id: 'user-1', bucket: 'game-ui-originals', path: 'user-1/game-1/a/original.png' },
      { id: 2, owner_id: 'user-2', bucket: 'game-ui-originals', path: 'user-2/game-2/b/original.png' },
    ])
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.deleteImages(['image-a'])

    expect(result).toMatchObject({ status: 'complete', pendingCleanup: 0 })
    expect(queue.map((row) => row.id)).toEqual([2])
    expect(rpc).toHaveBeenCalledWith('acknowledge_storage_cleanup', { p_queue_ids: [1] })
    expect(rpc).not.toHaveBeenCalledWith('acknowledge_storage_cleanup', { p_queue_ids: [2] })
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

  it('clears a durable cleanup task on the next snapshot after Storage deletion outlives a failed acknowledgement', async () => {
    const { client, queue, calls } = mutationClient([
      { id: 1, owner_id: 'user-1', bucket: 'game-ui-originals', path: 'user-1/game-1/a/original.png' },
    ], undefined, true, { queueAckFailures: 1 })
    const repository = new SupabaseLibraryRepository(client as never)

    const deletion = await repository.deleteImages(['image-a'])
    expect(deletion).toMatchObject({ status: 'partial', pendingCleanup: 1 })
    expect(queue.map((row) => row.id)).toEqual([1])

    const snapshot = await repository.getSnapshot()

    expect(snapshot).toEqual({ games: [], modules: [], images: [], captureSets: [] })
    await vi.waitFor(() => expect(queue).toEqual([]))
    expect(calls).toEqual([
      { bucket: 'game-ui-originals', paths: ['user-1/game-1/a/original.png'] },
      { bucket: 'game-ui-originals', paths: ['user-1/game-1/a/original.png'] },
    ])
  })

  it('reports concurrent cleanup drains complete when another drain already acknowledged the same task', async () => {
    let releaseStorage!: () => void
    const storageGate = new Promise<void>((resolve) => { releaseStorage = resolve })
    const { client, queue, calls } = mutationClient([
      { id: 1, owner_id: 'user-1', bucket: 'game-ui-originals', path: 'user-1/game-1/a/original.png' },
    ], undefined, false, { storageGate })
    const repository = new SupabaseLibraryRepository(client as never)
    const deletions = [repository.deleteImages(['image-a']), repository.deleteImages(['image-b'])]

    try {
      await vi.waitFor(() => expect(calls).toHaveLength(2))
    } finally {
      releaseStorage()
    }

    await expect(Promise.all(deletions)).resolves.toEqual([
      { status: 'complete', pendingCleanup: 0 },
      { status: 'complete', pendingCleanup: 0 },
    ])
    expect(queue).toEqual([])
  })

  it('continues cleanup when the API returns fewer rows than the requested page size', async () => {
    const { client, queue, calls } = mutationClient([
      { id: 1, owner_id: 'user-1', bucket: 'game-ui-originals', path: 'user-1/game-1/a/original.png' },
      { id: 2, owner_id: 'user-1', bucket: 'game-ui-originals', path: 'user-1/game-1/b/original.png' },
      { id: 3, owner_id: 'user-1', bucket: 'game-ui-originals', path: 'user-1/game-1/c/original.png' },
    ], undefined, false, { queueReadLimit: 1 })
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.deleteImages(['image-a', 'image-b', 'image-c'])

    expect(result).toEqual({ status: 'complete', pendingCleanup: 0 })
    expect(queue).toEqual([])
    expect(calls.flatMap((call) => call.paths)).toEqual([
      'user-1/game-1/a/original.png',
      'user-1/game-1/b/original.png',
      'user-1/game-1/c/original.png',
    ])
  })

  it('leaves cleanup tasks enqueued after the drain starts for a later bounded run', async () => {
    const laterRow = {
      id: 2,
      owner_id: 'user-1',
      bucket: 'game-ui-originals',
      path: 'user-1/game-2/later/original.png',
    }
    const { client, queue, calls } = mutationClient([
      { id: 1, owner_id: 'user-1', bucket: 'game-ui-originals', path: 'user-1/game-1/current/original.png' },
    ], undefined, false, { enqueueAfterFirstRemove: laterRow })
    const repository = new SupabaseLibraryRepository(client as never)

    const result = await repository.deleteImages(['image-current'])

    expect(result).toEqual({ status: 'complete', pendingCleanup: 0 })
    expect(queue).toEqual([laterRow])
    expect(calls).toEqual([{
      bucket: 'game-ui-originals',
      paths: ['user-1/game-1/current/original.png'],
    }])
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
    expect(rpc.mock.calls).toEqual([
      ['delete_game', { p_game_id: 'game-1' }],
      ['acknowledge_storage_cleanup', { p_queue_ids: [1] }],
    ])
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

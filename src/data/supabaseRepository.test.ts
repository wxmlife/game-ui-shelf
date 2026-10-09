import { describe, expect, it, vi } from 'vitest'

import type { ImportSubmission } from './libraryRepository'
import { SupabaseLibraryRepository } from './supabaseRepository'

function session(userId = 'user-1') {
  return { data: { session: { user: { id: userId } } }, error: null }
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
    const createSignedUrl = vi.fn(async (path: string, _expiresIn: number) => ({ data: { signedUrl: `signed://bucket/${path}` }, error: null }))
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
          createSignedUrl: vi.fn(async (path: string, expiresIn: number) => {
            const result = await createSignedUrl(path, expiresIn)
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
      thumbnailUrl: 'signed://game-ui-thumbnails/user-1/game-1/image-1/thumb.webp',
    })
    expect(createSignedUrl).toHaveBeenCalledWith(expect.any(String), 86_400)
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
})

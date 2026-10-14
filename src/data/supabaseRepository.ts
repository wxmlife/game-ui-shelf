import type { SupabaseClient } from '@supabase/supabase-js'

import type { Game, GameModule, LibrarySnapshot, UiImage } from '../domain/models'
import type {
  ImportSubmission,
  ImportSubmissionFile,
  ImageMetadataUpdate,
  LibraryRepository,
  ModuleUpdate,
  MutationResult,
  UploadBatchResult,
} from './libraryRepository'

const ORIGINALS_BUCKET = 'game-ui-originals'
const THUMBNAILS_BUCKET = 'game-ui-thumbnails'
// A gallery can stay open during a full design session. One-day signed URLs
// avoid broken thumbnails/downloads without making either bucket public.
const SIGNED_URL_SECONDS = 24 * 60 * 60
const CLEANUP_PAGE_SIZE = 500
const STORAGE_REMOVE_CHUNK_SIZE = 100

type Row = Record<string, unknown>
interface CleanupRow { id: number; bucket: string; path: string }

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function related(value: unknown): Row | undefined {
  if (Array.isArray(value)) return value[0] as Row | undefined
  return value && typeof value === 'object' ? value as Row : undefined
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\p{Script=Han}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return slug || `game-${Date.now()}`
}

function safeFileExtension(value: string): string {
  const dotIndex = value.lastIndexOf('.')
  if (dotIndex < 0) return 'bin'
  return value.slice(dotIndex + 1).toLocaleLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'bin'
}

function uniqueId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return '上传失败'
}

export class SupabaseLibraryRepository implements LibraryRepository {
  readonly mode = 'cloud' as const
  private cleanupInFlight?: { ownerId: string; promise: Promise<void> }

  constructor(private readonly client: SupabaseClient) {}

  private async userId(): Promise<string> {
    const { data, error } = await this.client.auth.getSession()
    if (error) throw error
    if (!data.session?.user.id) throw new Error('请先登录后访问私有资料库')
    return data.session.user.id
  }

  private async rows(table: string, selection = '*'): Promise<Row[]> {
    const { data, error } = await this.client.from(table).select(selection)
    if (error) throw error
    return (data ?? []) as unknown as Row[]
  }

  private async signedUrl(bucket: string, path: unknown, downloadName?: string): Promise<string> {
    if (typeof path !== 'string' || !path) return ''
    const storage = this.client.storage.from(bucket)
    const { data, error } = downloadName
      ? await storage.createSignedUrl(path, SIGNED_URL_SECONDS, { download: downloadName })
      : await storage.createSignedUrl(path, SIGNED_URL_SECONDS)
    if (error) throw error
    return data.signedUrl
  }

  private async drainCleanupQueue(ownerId: string): Promise<number> {
    let pending = 0
    let afterId = 0
    const { data: latestRows, error: latestError } = await this.client.from('storage_cleanup_queue')
      .select('id')
      .eq('owner_id', ownerId)
      .order('id', { ascending: false })
      .limit(1)
    if (latestError) throw latestError
    const highWatermark = ((latestRows ?? []) as Array<{ id?: unknown }>)[0]?.id
    if (highWatermark === undefined) return 0
    if (typeof highWatermark !== 'number' || !Number.isFinite(highWatermark)) {
      throw new Error('清理队列返回了无效的任务 ID')
    }

    while (true) {
      const { data, error } = await this.client.from('storage_cleanup_queue')
        .select('id,bucket,path')
        .eq('owner_id', ownerId)
        .gt('id', afterId)
        .lte('id', highWatermark)
        .order('id', { ascending: true })
        .limit(CLEANUP_PAGE_SIZE)
      if (error) throw error
      const rows = (data ?? []) as CleanupRow[]
      if (!rows.length) break
      afterId = rows[rows.length - 1].id

      for (const bucket of [ORIGINALS_BUCKET, THUMBNAILS_BUCKET]) {
        const bucketRows = rows.filter((row) => row.bucket === bucket)
        for (let start = 0; start < bucketRows.length; start += STORAGE_REMOVE_CHUNK_SIZE) {
          const chunk = bucketRows.slice(start, start + STORAGE_REMOVE_CHUNK_SIZE)
          // A thrown or returned Storage error does not prove whether the request
          // reached the server, so the database check below decides what to ack.
          try {
            await this.client.storage.from(bucket).remove(chunk.map((row) => row.path))
          } catch {
            // Fall through to the owner-scoped absence check.
          }
          try {
            const chunkIds = new Set(chunk.map((row) => row.id))
            const { error: queueError } = await this.client.rpc('acknowledge_storage_cleanup', {
              p_queue_ids: [...chunkIds],
            })
            if (queueError) throw queueError
            // Another drain can acknowledge the same row while this request is
            // waiting for the RPC lock. Re-read the owner-scoped queue instead
            // of deriving pending work from this call's acknowledgement count.
            const { data: remaining, error: remainingError } = await this.client.from('storage_cleanup_queue')
              .select('id')
              .eq('owner_id', ownerId)
              .in('id', [...chunkIds])
            if (remainingError) throw remainingError
            const remainingIds = new Set(
              ((remaining ?? []) as Array<{ id?: unknown }>)
                .map((row) => row.id)
                .filter((id): id is number => typeof id === 'number' && chunkIds.has(id)),
            )
            pending += remainingIds.size
          } catch {
            pending += chunk.length
          }
        }
      }
      pending += rows.filter((row) => row.bucket !== ORIGINALS_BUCKET && row.bucket !== THUMBNAILS_BUCKET).length
    }

    return pending
  }

  private startBackgroundCleanup(ownerId: string): void {
    if (this.cleanupInFlight?.ownerId === ownerId) return
    const promise = this.drainCleanupQueue(ownerId)
      .then(() => undefined, () => undefined)
      .finally(() => {
        if (this.cleanupInFlight?.promise === promise) this.cleanupInFlight = undefined
      })
    this.cleanupInFlight = { ownerId, promise }
  }

  private async cleanupResult(ownerId: string): Promise<MutationResult> {
    try {
      const pendingCleanup = await this.drainCleanupQueue(ownerId)
      return pendingCleanup
        ? { status: 'partial', pendingCleanup, message: '资料已删除，部分文件仍待清理，将在下次加载时重试' }
        : { status: 'complete', pendingCleanup: 0 }
    } catch {
      return { status: 'partial', message: '资料已删除，文件清理将在下次加载时重试' }
    }
  }

  async getSnapshot(): Promise<LibrarySnapshot> {
    const ownerId = await this.userId()
    this.startBackgroundCleanup(ownerId)
    const [gameRows, captureRows, moduleRows, imageRows] = await Promise.all([
      this.rows('games'),
      this.rows('capture_sets'),
      this.rows('modules'),
      this.rows('ui_images', '*, modules(key,name), flows(name), capture_sets(platform,version), image_tags(tags(name))'),
    ])

    const images: UiImage[] = await Promise.all(imageRows.map(async (row) => {
      const module = related(row.modules)
      const flow = related(row.flows)
      const captureSet = related(row.capture_sets)
      const tagRows = Array.isArray(row.image_tags) ? row.image_tags as Row[] : []
      const tags = tagRows
        .map((item) => related(item.tags))
        .map((tag) => text(tag?.name))
        .filter(Boolean)

      const originalFilename = text(row.original_filename)
      const imageUrl = await this.signedUrl(ORIGINALS_BUCKET, row.original_path)
      const downloadUrl = await this.signedUrl(ORIGINALS_BUCKET, row.original_path, originalFilename)
      const thumbnailUrl = await this.signedUrl(THUMBNAILS_BUCKET, row.thumbnail_path)

      return {
        id: text(row.id),
        gameId: text(row.game_id),
        captureSetId: text(row.capture_set_id) || undefined,
        moduleId: text(row.module_id),
        moduleKey: text(module?.key),
        moduleName: text(module?.name),
        flowId: text(row.flow_id) || undefined,
        flowName: text(flow?.name) || undefined,
        title: text(row.title),
        originalFilename,
        imageUrl,
        downloadUrl,
        thumbnailUrl: thumbnailUrl || imageUrl,
        width: number(row.width),
        height: number(row.height),
        sequenceOrder: number(row.sequence_order),
        tags,
        platform: text(captureSet?.platform) || undefined,
        version: text(captureSet?.version) || undefined,
        createdAt: text(row.created_at),
        searchText: text(row.search_text) || undefined,
      }
    }))

    const imageCountByGame = new Map<string, number>()
    for (const image of images) imageCountByGame.set(image.gameId, (imageCountByGame.get(image.gameId) ?? 0) + 1)

    const games: Game[] = await Promise.all(gameRows.map(async (row) => ({
      id: text(row.id),
      slug: text(row.slug),
      name: text(row.name),
      aliases: strings(row.aliases),
      coverUrl: await this.signedUrl(THUMBNAILS_BUCKET, row.cover_thumbnail_path) || undefined,
      coverTone: text(row.cover_tone, '#26312c'),
      developer: text(row.developer) || undefined,
      platforms: strings(row.platforms),
      tags: strings(row.tags),
      imageCount: imageCountByGame.get(text(row.id)) ?? number(row.image_count),
      updatedAt: text(row.updated_at),
      description: text(row.description) || undefined,
    })))

    const modules: GameModule[] = moduleRows.map((row) => ({
      id: text(row.id),
      gameId: text(row.game_id),
      key: text(row.key),
      name: text(row.name),
      sortOrder: number(row.sort_order),
    }))

    return {
      games,
      modules,
      images,
      captureSets: captureRows.map((row) => ({
        id: text(row.id),
        gameId: text(row.game_id),
        platform: text(row.platform),
        version: text(row.version) || undefined,
        region: text(row.region) || undefined,
        capturedAt: text(row.captured_at) || undefined,
        sourceUrl: text(row.source_url) || undefined,
        note: text(row.note) || undefined,
      })),
    }
  }

  private async rowId(
    table: string,
    action: 'insert' | 'upsert',
    payload: Row,
    options?: { onConflict: string },
  ): Promise<string> {
    const query = action === 'upsert'
      ? this.client.from(table).upsert(payload, options)
      : this.client.from(table).insert(payload)
    const { data, error } = await query.select('id').single()
    if (error) throw error
    return text((data as Row).id)
  }

  private async uploadFile(
    userId: string,
    gameId: string,
    captureSetId: string,
    moduleId: string,
    flowId: string | undefined,
    item: ImportSubmissionFile,
  ): Promise<void> {
    const objectId = uniqueId()
    const originalPath = `${userId}/${gameId}/${objectId}/original.${safeFileExtension(item.originalFilename)}`
    const thumbnailExtension = item.thumbnail?.type === 'image/png' ? 'png' : 'webp'
    const thumbnailPath = `${userId}/${gameId}/${objectId}/thumbnail.${thumbnailExtension}`
    const uploaded: Array<{ bucket: string; path: string }> = []

    try {
      const originalUpload = await this.client.storage.from(ORIGINALS_BUCKET).upload(originalPath, item.file, {
        contentType: item.file.type || undefined,
        upsert: false,
      })
      if (originalUpload.error) throw originalUpload.error
      uploaded.push({ bucket: ORIGINALS_BUCKET, path: originalPath })

      let storedThumbnailPath: string | null = null
      if (item.thumbnail) {
        const thumbnailUpload = await this.client.storage.from(THUMBNAILS_BUCKET).upload(thumbnailPath, item.thumbnail, {
          contentType: item.thumbnail.type || 'image/webp',
          upsert: false,
        })
        if (thumbnailUpload.error) throw thumbnailUpload.error
        uploaded.push({ bucket: THUMBNAILS_BUCKET, path: thumbnailPath })
        storedThumbnailPath = thumbnailPath
      }

      const { error: metadataError } = await this.client.rpc('create_ui_image_with_tags', {
        p_game_id: gameId,
        p_capture_set_id: captureSetId,
        p_module_id: moduleId,
        p_flow_id: flowId ?? null,
        p_title: item.title,
        p_original_filename: item.originalFilename,
        p_original_path: originalPath,
        p_thumbnail_path: storedThumbnailPath,
        p_mime_type: item.file.type || 'application/octet-stream',
        p_width: item.width ?? 0,
        p_height: item.height ?? 0,
        p_file_size_bytes: item.file.size,
        p_sequence_order: item.sequenceOrder,
        p_fingerprint: `${item.file.size}:${item.file.lastModified}:${item.originalFilename.toLocaleLowerCase()}`,
        p_search_text: [item.title, item.moduleKey, item.moduleName, item.flowName, ...item.tags].filter(Boolean).join(' '),
        p_tags: [...new Set(item.tags.map((tag) => tag.trim()).filter(Boolean))],
      })
      if (metadataError) throw metadataError
    } catch (error) {
      await Promise.allSettled(uploaded.map(({ bucket, path }) => this.client.storage.from(bucket).remove([path])))
      throw error
    }
  }

  async submitImport(draft: ImportSubmission): Promise<UploadBatchResult> {
    const userId = await this.userId()
    const gameId = await this.rowId('games', 'upsert', {
      owner_id: userId,
      slug: slugify(draft.gameName),
      name: draft.gameName,
      platforms: draft.platform ? [draft.platform] : [],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'owner_id,slug' })
    const captureSetId = await this.rowId('capture_sets', 'insert', {
      owner_id: userId,
      game_id: gameId,
      platform: draft.platform || '未标注',
      version: draft.version ?? null,
    })
    const moduleIds = new Map<string, string>()
    const flowIds = new Map<string, string>()
    const failures: UploadBatchResult['failures'] = []
    let uploaded = 0

    for (const item of draft.files) {
      try {
        let moduleId = moduleIds.get(item.moduleKey)
        if (!moduleId) {
          moduleId = await this.rowId('modules', 'upsert', {
            owner_id: userId,
            game_id: gameId,
            key: item.moduleKey,
            name: item.moduleName,
            sort_order: moduleIds.size,
          }, { onConflict: 'owner_id,game_id,key' })
          moduleIds.set(item.moduleKey, moduleId)
        }

        let flowId: string | undefined
        if (item.flowName) {
          const flowKey = `${moduleId}:${item.flowName}`
          flowId = flowIds.get(flowKey)
          if (!flowId) {
            flowId = await this.rowId('flows', 'upsert', {
              owner_id: userId,
              module_id: moduleId,
              name: item.flowName,
              sort_order: flowIds.size,
            }, { onConflict: 'owner_id,module_id,name' })
            flowIds.set(flowKey, flowId)
          }
        }

        await this.uploadFile(userId, gameId, captureSetId, moduleId, flowId, item)
        uploaded += 1
      } catch (error) {
        failures.push({ fileId: item.id, fileName: item.originalFilename, message: errorMessage(error) })
      }
    }

    return {
      status: failures.length ? 'partial' : 'complete',
      uploaded,
      failures,
      message: failures.length ? '部分图片上传失败，可保留成功项并重试失败文件' : undefined,
    }
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut()
    if (error) throw error
  }

  async updateModule(moduleId: string, update: ModuleUpdate): Promise<MutationResult> {
    const userId = await this.userId()
    const { error } = await this.client
      .from('modules')
      .update({ key: update.key.trim(), name: update.name.trim() })
      .eq('id', moduleId)
      .eq('owner_id', userId)
    if (error) throw error
    return { status: 'complete' }
  }

  async updateImageMetadata(imageId: string, update: ImageMetadataUpdate): Promise<MutationResult> {
    await this.userId()
    const tags = [...new Set(update.tags.map((tag) => tag.trim()).filter(Boolean))]
    const { error } = await this.client.rpc('update_ui_image_metadata_with_tags', {
      p_image_id: imageId,
      p_module_id: update.moduleId,
      p_title: update.title.trim(),
      p_flow_name: update.flowName.trim(),
      p_sequence_order: update.sequenceOrder,
      p_search_text: [update.title, update.flowName, ...tags].filter(Boolean).join(' '),
      p_tags: tags,
    })
    if (error) throw error

    return { status: 'complete' }
  }

  async moveImage(imageId: string, targetModuleId: string): Promise<MutationResult> {
    await this.userId()
    const { error } = await this.client.rpc('move_ui_image_to_module', {
      p_image_id: imageId,
      p_target_module_id: targetModuleId,
    })
    if (error) throw error
    return { status: 'complete' }
  }

  async deleteImages(imageIds: string[]): Promise<MutationResult> {
    if (!imageIds.length) return { status: 'complete', pendingCleanup: 0 }
    const ownerId = await this.userId()
    const { error } = await this.client.rpc('delete_ui_images', { p_image_ids: imageIds })
    if (error) throw error
    return this.cleanupResult(ownerId)
  }

  async deleteGame(gameId: string): Promise<MutationResult> {
    const ownerId = await this.userId()
    const { error } = await this.client.rpc('delete_game', { p_game_id: gameId })
    if (error) throw error
    return this.cleanupResult(ownerId)
  }
}

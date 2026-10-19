import type { SupabaseClient } from '@supabase/supabase-js'

import type { Game, GameModule, LibrarySnapshot, UiImage } from '../domain/models'
import { fileFingerprint } from '../domain/fileFingerprint'
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
const FINGERPRINT_QUERY_CHUNK_SIZE = 10

type Row = Record<string, unknown>
interface CleanupRow { id: number; bucket: string; path: string }

class UnconfirmedUploadError extends Error {}

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

function isConfirmedRpcRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) || typeof error.code !== 'string') return false
  // A SQL error rolls the transaction back. Connection errors (class 08) and
  // unknown transport failures do not prove whether the commit reached us.
  return (/^[0-9A-Z]{5}$/.test(error.code) && !error.code.startsWith('08'))
    || /^PGRST[123][0-9]{2}$/.test(error.code)
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

  private async cleanupResult(ownerId: string, successMessage = '资料已删除'): Promise<MutationResult> {
    try {
      const pendingCleanup = await this.drainCleanupQueue(ownerId)
      return pendingCleanup
        ? { status: 'partial', pendingCleanup, message: `${successMessage}，部分文件仍待清理，将在下次加载时重试` }
        : { status: 'complete', pendingCleanup: 0 }
    } catch {
      return { status: 'partial', message: `${successMessage}，文件清理将在下次加载时重试` }
    }
  }

  private async enqueueStorageCleanup(ownerId: string, bucket: string, path: string): Promise<boolean> {
    try {
      const { error } = await this.client.from('storage_cleanup_queue').upsert({
        owner_id: ownerId, bucket, path,
      }, { onConflict: 'owner_id,bucket,path', ignoreDuplicates: true })
      return !error
    } catch {
      return false
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
      coverFocusX: number(row.cover_focus_x, 50),
      coverFocusY: number(row.cover_focus_y, 50),
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

      const metadataParameters = {
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
        p_fingerprint: fileFingerprint(item.file, item.originalFilename),
        p_search_text: [item.title, item.moduleKey, item.moduleName, item.flowName, ...item.tags].filter(Boolean).join(' '),
        p_tags: [...new Set(item.tags.map((tag) => tag.trim()).filter(Boolean))],
      }
      let unconfirmedError: unknown
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const { error: metadataError } = await this.client.rpc('create_ui_image_with_tags', metadataParameters)
          if (!metadataError) return
          if (isConfirmedRpcRejection(metadataError)) {
            if (unconfirmedError) break
            throw metadataError
          }
          unconfirmedError = metadataError
        } catch (error) {
          if (isConfirmedRpcRejection(error)) {
            if (unconfirmedError) break
            throw error
          }
          unconfirmedError = error
        }
      }
      throw new UnconfirmedUploadError(
        `上传结果未确认，请刷新资料库后检查并重试：${errorMessage(unconfirmedError)}`,
      )
    } catch (error) {
      // A lost RPC response may mean the row already references these paths.
      // The idempotent retry above is safe; if it also cannot confirm the
      // outcome, preserve the files rather than turning a success into broken data.
      if (error instanceof UnconfirmedUploadError) throw error
      await Promise.allSettled(uploaded.map(({ bucket, path }) => this.client.storage.from(bucket).remove([path])))
      throw error
    }
  }

  private async existingFingerprints(
    userId: string,
    gameId: string,
    fingerprints: readonly string[],
  ): Promise<Set<string>> {
    const existing = new Set<string>()
    const uniqueFingerprints = [...new Set(fingerprints)]
    for (let start = 0; start < uniqueFingerprints.length; start += FINGERPRINT_QUERY_CHUNK_SIZE) {
      const chunk = uniqueFingerprints.slice(start, start + FINGERPRINT_QUERY_CHUNK_SIZE)
      const { data, error } = await this.client
        .from('ui_images')
        .select('fingerprint')
        .eq('owner_id', userId)
        .eq('game_id', gameId)
        .in('fingerprint', chunk)
      if (error) throw error
      for (const row of (data ?? []) as Array<{ fingerprint?: unknown }>) {
        if (typeof row.fingerprint === 'string') existing.add(row.fingerprint)
      }
    }
    return existing
  }

  async submitImport(draft: ImportSubmission): Promise<UploadBatchResult> {
    const userId = await this.userId()
    const gamePayload: Row = {
      owner_id: userId,
      slug: slugify(draft.gameName),
      name: draft.gameName,
      updated_at: new Date().toISOString(),
    }
    if (draft.platform) gamePayload.platforms = [draft.platform]
    const gameId = await this.rowId('games', 'upsert', gamePayload, { onConflict: 'owner_id,slug' })

    const fingerprints = draft.files.map((item) => fileFingerprint(item.file, item.originalFilename))
    const existing = await this.existingFingerprints(userId, gameId, fingerprints)
    const pendingFiles: ImportSubmissionFile[] = []
    const queuedFingerprints = new Set<string>()
    let skipped = 0
    for (let index = 0; index < draft.files.length; index += 1) {
      const fingerprint = fingerprints[index]
      if (existing.has(fingerprint) || queuedFingerprints.has(fingerprint)) {
        skipped += 1
      } else {
        queuedFingerprints.add(fingerprint)
        pendingFiles.push(draft.files[index])
      }
    }
    if (!pendingFiles.length) {
      return {
        status: 'complete',
        uploaded: 0,
        skipped,
        failures: [],
        message: `这 ${skipped} 张图片已在当前游戏中，已跳过重复项`,
      }
    }

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

    for (const item of pendingFiles) {
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
      skipped,
      failures,
      message: failures.length
        ? `部分图片上传失败${skipped ? `，另有 ${skipped} 张重复图片已跳过` : ''}，可保留成功项并重试失败文件`
        : skipped
          ? `已上传 ${uploaded} 张图片，另有 ${skipped} 张已存在并跳过`
          : undefined,
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
    const { error } = await this.client.rpc('update_ui_image_metadata_without_order', {
      p_image_id: imageId,
      p_module_id: update.moduleId,
      p_title: update.title.trim(),
      p_flow_name: update.flowName.trim(),
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

  async placeImage(imageId: string, targetModuleId: string, beforeImageId: string | null): Promise<MutationResult> {
    await this.userId()
    const { error } = await this.client.rpc('place_ui_image', {
      p_image_id: imageId,
      p_target_module_id: targetModuleId,
      p_before_image_id: beforeImageId,
    })
    if (error) throw error
    return { status: 'complete' }
  }

  async updateGameCoverFocus(gameId: string, x: number, y: number): Promise<MutationResult> {
    if (![x, y].every((value) => Number.isFinite(value) && value >= 0 && value <= 100)) {
      throw new Error('封面焦点必须在 0 到 100 之间')
    }
    await this.userId()
    const { error } = await this.client.rpc('update_game_cover_focus', {
      p_game_id: gameId,
      p_focus_x: x,
      p_focus_y: y,
    })
    if (error) throw error
    return { status: 'complete' }
  }

  async setGameCoverFromImage(gameId: string, imageId: string): Promise<MutationResult> {
    return this.setGameCoverFromImageUsingRpc(gameId, imageId, 'set_game_cover_from_image')
  }

  async setGameCoverFromImageWithFocus(
    gameId: string,
    imageId: string,
    x: number,
    y: number,
  ): Promise<MutationResult> {
    if (![x, y].every((value) => Number.isFinite(value) && value >= 0 && value <= 100)) {
      throw new Error('封面焦点必须在 0 到 100 之间')
    }
    return this.setGameCoverFromImageUsingRpc(
      gameId,
      imageId,
      'set_game_cover_from_image_with_focus',
      { p_focus_x: x, p_focus_y: y },
    )
  }

  private async setGameCoverFromImageUsingRpc(
    gameId: string,
    imageId: string,
    rpcName: 'set_game_cover_from_image' | 'set_game_cover_from_image_with_focus',
    extraRpcArguments: Record<string, number> = {},
  ): Promise<MutationResult> {
    const ownerId = await this.userId()
    const { data: image, error: imageError } = await this.client.from('ui_images')
      .select('thumbnail_path')
      .eq('id', imageId)
      .eq('owner_id', ownerId)
      .eq('game_id', gameId)
      .maybeSingle()
    if (imageError) throw imageError
    if (!image) throw new Error('图片不存在或不属于当前游戏')
    const thumbnailPath = text(image.thumbnail_path)
    if (!thumbnailPath) throw new Error('这张图片没有缩略图，请重新上传生成缩略图后再设为封面')
    if (!thumbnailPath.startsWith(`${ownerId}/${gameId}/`)) throw new Error('缩略图路径不属于当前账号和游戏')

    const coverPath = `${ownerId}/${gameId}/covers/${uniqueId()}/thumbnail.${safeFileExtension(thumbnailPath)}`
    let copyFailure: unknown
    try {
      const { error } = await this.client.storage.from(THUMBNAILS_BUCKET).copy(thumbnailPath, coverPath)
      copyFailure = error
    } catch (error) {
      copyFailure = error
    }
    if (copyFailure) {
      // Storage failures are ambiguous: the server may have copied the object
      // before the response failed. Persist the unique destination for a later
      // cleanup pass, but do not drain it in this request.
      const queued = await this.enqueueStorageCleanup(ownerId, THUMBNAILS_BUCKET, coverPath)
      if (!queued) throw new Error(`${errorMessage(copyFailure)}；封面副本清理任务保存失败，请稍后重试`)
      throw copyFailure
    }

    try {
      const { error } = await this.client.rpc(rpcName, {
        p_game_id: gameId,
        p_image_id: imageId,
        p_cover_thumbnail_path: coverPath,
        ...extraRpcArguments,
      })
      if (error) throw error
    } catch (error) {
      if (isConfirmedRpcRejection(error)) {
        const queued = await this.enqueueStorageCleanup(ownerId, THUMBNAILS_BUCKET, coverPath)
        if (queued) {
          await this.cleanupResult(ownerId)
        } else {
          let removed = false
          try {
            const { data, error: removeError } = await this.client.storage.from(THUMBNAILS_BUCKET).remove([coverPath])
            removed = !removeError && !!data?.some((object) => object.name === coverPath)
          } catch {
            // Keep the original error, but make an untracked orphan visible.
          }
          if (!removed) throw new Error(`${errorMessage(error)}；未使用的封面副本清理未完成，请稍后重试`)
        }
        throw error
      }
      // Losing the RPC response is not proof of rollback. Only treat the
      // operation as successful when its unique copy is now authoritative;
      // otherwise retain it, since a late commit may still reference it.
      try {
        const { data: game, error: readError } = await this.client.from('games')
          .select('cover_thumbnail_path')
          .eq('id', gameId)
          .eq('owner_id', ownerId)
          .maybeSingle()
        if (!readError && game?.cover_thumbnail_path === coverPath) return this.cleanupResult(ownerId, '封面已更新')
      } catch {
        // No destructive compensation when the authoritative read also fails.
      }
      throw new Error(`封面更新结果未确认，请刷新资料库后检查并重试：${errorMessage(error)}`)
    }

    return this.cleanupResult(ownerId, '封面已更新')
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

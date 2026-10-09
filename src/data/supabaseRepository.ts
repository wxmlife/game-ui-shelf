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
const SIGNED_URL_SECONDS = 10 * 60

type Row = Record<string, unknown>

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

function safePathSegment(value: string): string {
  return value.normalize('NFKC').replace(/[^a-zA-Z0-9._\-\p{Script=Han}]+/gu, '-').slice(0, 120) || 'image'
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

  private async signedUrl(bucket: string, path: unknown): Promise<string> {
    if (typeof path !== 'string' || !path) return ''
    const { data, error } = await this.client.storage.from(bucket).createSignedUrl(path, SIGNED_URL_SECONDS)
    if (error) throw error
    return data.signedUrl
  }

  async getSnapshot(): Promise<LibrarySnapshot> {
    await this.userId()
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

      const imageUrl = await this.signedUrl(ORIGINALS_BUCKET, row.original_path)
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
        originalFilename: text(row.original_filename),
        imageUrl,
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
    const originalPath = `${userId}/${gameId}/${objectId}/${safePathSegment(item.originalFilename)}`
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

      const imageId = await this.rowId('ui_images', 'insert', {
        owner_id: userId,
        game_id: gameId,
        capture_set_id: captureSetId,
        module_id: moduleId,
        flow_id: flowId ?? null,
        title: item.title,
        original_filename: item.originalFilename,
        original_path: originalPath,
        thumbnail_path: storedThumbnailPath,
        mime_type: item.file.type || null,
        file_size_bytes: item.file.size,
        sequence_order: item.sequenceOrder,
        fingerprint: `${item.file.size}:${item.file.lastModified}:${item.originalFilename.toLocaleLowerCase()}`,
        search_text: [item.title, item.moduleKey, item.moduleName, item.flowName, ...item.tags].filter(Boolean).join(' '),
      })

      for (const tagName of [...new Set(item.tags.map((tag) => tag.trim()).filter(Boolean))]) {
        const tagId = await this.rowId('tags', 'upsert', { owner_id: userId, name: tagName }, { onConflict: 'owner_id,name' })
        const { error } = await this.client.from('image_tags').upsert(
          { owner_id: userId, image_id: imageId, tag_id: tagId },
          { onConflict: 'owner_id,image_id,tag_id' },
        )
        if (error) throw error
      }
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
    const userId = await this.userId()
    let flowId: string | null = null
    if (update.flowName.trim()) {
      flowId = await this.rowId('flows', 'upsert', {
        owner_id: userId,
        module_id: update.moduleId,
        name: update.flowName.trim(),
        sort_order: 0,
      }, { onConflict: 'owner_id,module_id,name' })
    }

    const { error: imageError } = await this.client
      .from('ui_images')
      .update({
        title: update.title.trim(),
        flow_id: flowId,
        sequence_order: update.sequenceOrder,
        search_text: [update.title, update.flowName, ...update.tags].filter(Boolean).join(' '),
      })
      .eq('id', imageId)
      .eq('owner_id', userId)
    if (imageError) throw imageError

    const { error: deleteTagsError } = await this.client
      .from('image_tags')
      .delete()
      .eq('image_id', imageId)
      .eq('owner_id', userId)
    if (deleteTagsError) throw deleteTagsError

    for (const tagName of [...new Set(update.tags.map((tag) => tag.trim()).filter(Boolean))]) {
      const tagId = await this.rowId('tags', 'upsert', { owner_id: userId, name: tagName }, { onConflict: 'owner_id,name' })
      const { error } = await this.client.from('image_tags').insert({ owner_id: userId, image_id: imageId, tag_id: tagId })
      if (error) throw error
    }

    return { status: 'complete' }
  }
}

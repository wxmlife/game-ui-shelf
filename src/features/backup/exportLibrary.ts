import type {
  CaptureSet,
  Game,
  GameModule,
  LibrarySnapshot,
  UiImage,
} from '../../domain/models'

export const LIBRARY_EXPORT_SCHEMA_VERSION = 1 as const

export interface LibraryExport {
  schemaVersion: typeof LIBRARY_EXPORT_SCHEMA_VERSION
  exportedAt: string
  data: {
    games: Array<Omit<Game, 'coverUrl'> & { coverUrl: null }>
    captureSets: CaptureSet[]
    modules: GameModule[]
    images: Array<Omit<UiImage, 'imageUrl' | 'thumbnailUrl' | 'searchText'> & {
      imageUrl: null
      thumbnailUrl: null
    }>
  }
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort(compareStrings)
}

function normalizeExportedAt(exportedAt: string | Date): string {
  return new Date(exportedAt).toISOString()
}

function exportGame(game: Game): LibraryExport['data']['games'][number] {
  return {
    id: game.id,
    slug: game.slug,
    name: game.name,
    aliases: sortedStrings(game.aliases),
    coverUrl: null,
    coverTone: game.coverTone,
    coverFocusX: game.coverFocusX,
    coverFocusY: game.coverFocusY,
    developer: game.developer,
    platforms: sortedStrings(game.platforms),
    tags: sortedStrings(game.tags),
    imageCount: game.imageCount,
    updatedAt: game.updatedAt,
    description: game.description,
  }
}

function exportCaptureSet(captureSet: CaptureSet): CaptureSet {
  return {
    id: captureSet.id,
    gameId: captureSet.gameId,
    platform: captureSet.platform,
    version: captureSet.version,
    region: captureSet.region,
    capturedAt: captureSet.capturedAt,
    sourceUrl: captureSet.sourceUrl,
    note: captureSet.note,
  }
}

function exportModule(module: GameModule): GameModule {
  return {
    id: module.id,
    gameId: module.gameId,
    key: module.key,
    name: module.name,
    sortOrder: module.sortOrder,
  }
}

function exportImage(image: UiImage): LibraryExport['data']['images'][number] {
  return {
    id: image.id,
    gameId: image.gameId,
    captureSetId: image.captureSetId,
    moduleId: image.moduleId,
    moduleKey: image.moduleKey,
    moduleName: image.moduleName,
    flowId: image.flowId,
    flowName: image.flowName,
    title: image.title,
    originalFilename: image.originalFilename,
    imageUrl: null,
    thumbnailUrl: null,
    width: image.width,
    height: image.height,
    sequenceOrder: image.sequenceOrder,
    tags: sortedStrings(image.tags),
    platform: image.platform,
    version: image.version,
    createdAt: image.createdAt,
  }
}

/**
 * Creates a portable metadata backup. Storage URLs are intentionally replaced
 * with null because signed URLs and object URLs cannot be restored safely.
 */
export function createLibraryExport(
  snapshot: LibrarySnapshot,
  exportedAt: string | Date = new Date(),
): string {
  const backup: LibraryExport = {
    schemaVersion: LIBRARY_EXPORT_SCHEMA_VERSION,
    exportedAt: normalizeExportedAt(exportedAt),
    data: {
      games: snapshot.games.map(exportGame).sort((left, right) => compareStrings(left.id, right.id)),
      captureSets: snapshot.captureSets
        .map(exportCaptureSet)
        .sort((left, right) => compareStrings(left.id, right.id)),
      modules: snapshot.modules
        .map(exportModule)
        .sort((left, right) => compareStrings(left.id, right.id)),
      images: snapshot.images
        .map(exportImage)
        .sort((left, right) => compareStrings(left.id, right.id)),
    },
  }

  return `${JSON.stringify(backup, null, 2)}\n`
}

export function downloadLibraryExport(snapshot: LibrarySnapshot): void {
  const exportedAt = new Date().toISOString()
  const contents = createLibraryExport(snapshot, exportedAt)
  const blob = new Blob([contents], { type: 'application/json;charset=utf-8' })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = objectUrl
  link.download = `game-ui-shelf-backup-${exportedAt.slice(0, 10)}.json`
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}

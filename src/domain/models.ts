export type Identifier = string

export interface Game {
  id: Identifier
  slug: string
  name: string
  aliases: string[]
  coverUrl?: string
  coverTone: string
  developer?: string
  platforms: string[]
  tags: string[]
  imageCount: number
  updatedAt: string
  description?: string
}

export interface CaptureSet {
  id: Identifier
  gameId: Identifier
  platform: string
  version?: string
  region?: string
  capturedAt?: string
  sourceUrl?: string
  note?: string
}

export interface GameModule {
  id: Identifier
  gameId: Identifier
  key: string
  name: string
  sortOrder: number
}

export interface Flow {
  id: Identifier
  moduleId: Identifier
  name: string
  sortOrder: number
}

export interface UiImage {
  id: Identifier
  gameId: Identifier
  captureSetId?: Identifier
  moduleId: Identifier
  moduleKey: string
  moduleName: string
  flowId?: Identifier
  flowName?: string
  title: string
  originalFilename: string
  imageUrl: string
  downloadUrl?: string
  thumbnailUrl: string
  width: number
  height: number
  sequenceOrder: number
  tags: string[]
  platform?: string
  version?: string
  createdAt: string
  searchText?: string
}

export interface LibrarySnapshot {
  games: Game[]
  captureSets: CaptureSet[]
  modules: GameModule[]
  images: UiImage[]
}

export interface SearchFilters {
  gameId?: Identifier
  moduleKey?: string
  platform?: string
  version?: string
  tags?: string[]
}

export interface SearchResults {
  games: Game[]
  images: UiImage[]
}

export interface ImportIssue {
  code:
    | 'unsupported-type'
    | 'missing-game'
    | 'missing-module'
    | 'duplicate'
    | 'large-file'
  message: string
}

export interface ImportFileInput {
  relativePath: string
  fileName: string
  mimeType?: string
  sizeBytes?: number
  sourceIndex?: number
}

export interface ParsedImportFile {
  gameName: string
  moduleKey: string
  moduleName: string
  title: string
  steps: string[]
  sequenceOrder: number
  originalFilename: string
  relativePath: string
  extension: string
  mimeType?: string
  sizeBytes: number
  valid: boolean
  issues: ImportIssue[]
}

import type { LibrarySnapshot } from '../domain/models'

export interface ImportSubmissionFile {
  id: string
  file: File
  thumbnail?: Blob
  width?: number
  height?: number
  gameName: string
  moduleKey: string
  moduleName: string
  flowName?: string
  title: string
  tags: string[]
  sequenceOrder: number
  originalFilename: string
}

export interface ImportSubmission {
  gameName: string
  platform?: string
  version?: string
  files: ImportSubmissionFile[]
}

export interface UploadFailure {
  fileId: string
  fileName: string
  message: string
}

export interface UploadBatchResult {
  status: 'complete' | 'partial' | 'unavailable'
  uploaded: number
  skipped?: number
  failures: UploadFailure[]
  message?: string
}

export interface MutationResult {
  status: 'complete' | 'partial' | 'unavailable'
  pendingCleanup?: number
  message?: string
}

export interface ModuleUpdate {
  key: string
  name: string
}

export interface ImageMetadataUpdate {
  moduleId: string
  title: string
  flowName: string
  sequenceOrder: number
  tags: string[]
}

export interface LibraryRepository {
  readonly mode: 'demo' | 'cloud'
  getSnapshot(): Promise<LibrarySnapshot>
  submitImport(draft: ImportSubmission): Promise<UploadBatchResult>
  updateModule?(moduleId: string, update: ModuleUpdate): Promise<MutationResult>
  updateImageMetadata?(imageId: string, update: ImageMetadataUpdate): Promise<MutationResult>
  setGameCoverFromImage?(gameId: string, imageId: string): Promise<MutationResult>
  moveImage?(imageId: string, targetModuleId: string): Promise<MutationResult>
  deleteImages?(imageIds: string[]): Promise<MutationResult>
  deleteGame?(gameId: string): Promise<MutationResult>
  signOut?(): Promise<void>
}

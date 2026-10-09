import type { LibrarySnapshot } from '../domain/models'

export interface ImportSubmissionFile {
  id: string
  file: File
  thumbnail?: Blob
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
  failures: UploadFailure[]
  message?: string
}

export interface MutationResult {
  status: 'complete' | 'unavailable'
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
  signOut?(): Promise<void>
}

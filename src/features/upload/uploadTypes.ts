import type { ImportIssue } from '../../domain/models'

export type UploadDraftStatus = 'ready' | 'rejected'

export interface UploadDraftFile {
  id: string
  file: File
  relativePath: string
  fingerprint: string
  gameName: string
  moduleKey: string
  moduleName: string
  flowName: string
  title: string
  tags: string[]
  sequenceOrder: number
  originalFilename: string
  status: UploadDraftStatus
  issues: ImportIssue[]
}

export interface UploadDraft {
  gameName: string
  platform: string
  version: string
  files: UploadDraftFile[]
  readyFiles: UploadDraftFile[]
  rejectedFiles: UploadDraftFile[]
}

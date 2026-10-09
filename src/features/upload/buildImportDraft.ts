import type { ImportIssue } from '../../domain/models'
import { parseImportFile } from '../../domain/importParser'
import type { UploadDraft, UploadDraftFile } from './uploadTypes'

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

function relativePathFor(file: File): string {
  return file.webkitRelativePath || file.name
}

export function buildFileFingerprint(file: File): string {
  return [relativePathFor(file).toLocaleLowerCase(), file.size, file.lastModified].join(':')
}

function fileId(file: File, sourceIndex: number): string {
  return `${sourceIndex}-${buildFileFingerprint(file)}`
}

export function buildImportDraft(
  files: readonly File[],
  existingFingerprints: ReadonlySet<string> = new Set(),
): UploadDraft {
  const selectionFingerprints = new Set<string>()
  const draftFiles: UploadDraftFile[] = files.map((file, sourceIndex) => {
    const relativePath = relativePathFor(file)
    const parsed = parseImportFile({
      relativePath,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      sourceIndex,
    })
    const fingerprint = buildFileFingerprint(file)
    const issues: ImportIssue[] = [...parsed.issues]

    if (!issues.length && (existingFingerprints.has(fingerprint) || selectionFingerprints.has(fingerprint))) {
      issues.push({ code: 'duplicate', message: '这张图片已经存在或在本次选择中重复' })
    }
    if (!issues.length && file.size > MAX_UPLOAD_BYTES) {
      issues.push({ code: 'large-file', message: '单张图片不能超过 25 MB' })
    }
    selectionFingerprints.add(fingerprint)

    return {
      id: fileId(file, sourceIndex),
      file,
      relativePath,
      fingerprint,
      gameName: parsed.gameName,
      moduleKey: parsed.moduleKey,
      moduleName: parsed.moduleName,
      flowName: parsed.steps.length ? (parsed.steps.length > 1 ? parsed.steps[0] : parsed.moduleName) : '',
      title: parsed.title,
      tags: [],
      sequenceOrder: parsed.sequenceOrder,
      originalFilename: parsed.originalFilename,
      status: issues.length ? 'rejected' : 'ready',
      issues,
    }
  })
  const readyFiles = draftFiles.filter((file) => file.status === 'ready')
  const rejectedFiles = draftFiles.filter((file) => file.status === 'rejected')

  return {
    gameName: readyFiles[0]?.gameName ?? draftFiles[0]?.gameName ?? '',
    platform: '',
    version: '',
    files: draftFiles,
    readyFiles,
    rejectedFiles,
  }
}

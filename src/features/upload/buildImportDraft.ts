import type { ImportIssue } from '../../domain/models'
import { fileFingerprint } from '../../domain/fileFingerprint'
import { parseImportFile } from '../../domain/importParser'
import { deriveAutoTags } from './deriveAutoTags'
import type { UploadDraft, UploadDraftFile } from './uploadTypes'

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

function relativePathFor(file: File): string {
  return file.webkitRelativePath || file.name
}

export function buildFileFingerprint(file: File): string {
  return fileFingerprint(file)
}

function fileId(file: File, sourceIndex: number): string {
  return `${sourceIndex}-${buildFileFingerprint(file)}`
}

export function buildImportDraft(
  files: readonly File[],
  existingFingerprints: ReadonlySet<string> = new Set(),
): UploadDraft {
  const selectionFingerprints = new Set<string>()
  const explicitSequenceOrders: Array<number | undefined> = []
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
    explicitSequenceOrders.push(parsed.explicitSequenceOrder)

    return {
      id: fileId(file, sourceIndex),
      file,
      relativePath,
      fingerprint,
      gameName: parsed.gameName,
      moduleKey: parsed.moduleKey,
      moduleName: parsed.moduleName,
      flowName: parsed.flowName,
      title: parsed.title,
      tags: deriveAutoTags(parsed.moduleName, parsed.title),
      sequenceOrder: parsed.sequenceOrder,
      originalFilename: parsed.originalFilename,
      status: issues.length ? 'rejected' : 'ready',
      issues,
    }
  })
  const occupiedOrders = new Map<string, Set<number>>()
  for (let index = 0; index < draftFiles.length; index += 1) {
    const file = draftFiles[index]
    const explicitOrder = explicitSequenceOrders[index]
    if (file.status !== 'ready' || explicitOrder === undefined) continue
    const moduleOrders = occupiedOrders.get(file.moduleKey) ?? new Set<number>()
    moduleOrders.add(explicitOrder)
    occupiedOrders.set(file.moduleKey, moduleOrders)
  }
  const nextModuleOrders = new Map<string, number>()
  for (let index = 0; index < draftFiles.length; index += 1) {
    const file = draftFiles[index]
    if (file.status !== 'ready' || explicitSequenceOrders[index] !== undefined) continue
    const moduleOrders = occupiedOrders.get(file.moduleKey) ?? new Set<number>()
    let nextOrder = nextModuleOrders.get(file.moduleKey) ?? 1
    while (moduleOrders.has(nextOrder)) nextOrder += 1
    file.sequenceOrder = nextOrder
    moduleOrders.add(nextOrder)
    occupiedOrders.set(file.moduleKey, moduleOrders)
    nextModuleOrders.set(file.moduleKey, nextOrder + 1)
  }
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

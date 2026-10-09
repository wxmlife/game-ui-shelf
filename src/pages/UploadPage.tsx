import { AlertCircle, ArrowRight, CheckCircle2, LoaderCircle, ShieldCheck } from 'lucide-react'
import { useState } from 'react'

import { useLibrary } from '../app/LibraryContext'
import { ImportPreview } from '../components/ImportPreview'
import { UploadDropzone } from '../components/UploadDropzone'
import type { UploadBatchResult } from '../data/libraryRepository'
import { buildImportDraft } from '../features/upload/buildImportDraft'
import { createThumbnail } from '../features/upload/createThumbnail'
import type { ThumbnailBlob } from '../features/upload/createThumbnail'
import type { UploadDraft, UploadDraftFile } from '../features/upload/uploadTypes'

const THUMBNAIL_CONCURRENCY = 3

function updateFiles(draft: UploadDraft, files: UploadDraftFile[]): UploadDraft {
  return {
    ...draft,
    files,
    readyFiles: files.filter((file) => file.status === 'ready'),
    rejectedFiles: files.filter((file) => file.status === 'rejected'),
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  )
  return results
}

export function UploadPage() {
  const { repository, refresh } = useLibrary()
  const [draft, setDraft] = useState<UploadDraft | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<UploadBatchResult | null>(null)

  function selectFiles(files: File[]) {
    setDraft(buildImportDraft(files))
    setResult(null)
  }

  function changeFile(fileId: string, patch: Partial<UploadDraftFile>) {
    setDraft((current) => current
      ? updateFiles(current, current.files.map((file) => file.id === fileId ? { ...file, ...patch } : file))
      : current)
  }

  function removeFile(fileId: string) {
    setDraft((current) => current
      ? updateFiles(current, current.files.filter((file) => file.id !== fileId))
      : current)
  }

  async function submit() {
    if (!draft?.readyFiles.length || submitting) return
    setSubmitting(true)
    setResult(null)
    try {
      const files = await mapWithConcurrency(draft.readyFiles, THUMBNAIL_CONCURRENCY, async (item) => {
        let thumbnail: ThumbnailBlob | undefined
        try {
          thumbnail = await createThumbnail(item.file)
        } catch {
          // Some formats or browsers cannot render a local thumbnail; the original remains uploadable.
        }
        return {
          id: item.id,
          file: item.file,
          thumbnail,
          width: thumbnail?.sourceWidth,
          height: thumbnail?.sourceHeight,
          gameName: draft.gameName,
          moduleKey: item.moduleKey,
          moduleName: item.moduleName,
          flowName: item.flowName || undefined,
          title: item.title,
          tags: item.tags,
          sequenceOrder: item.sequenceOrder,
          originalFilename: item.originalFilename,
        }
      })
      const nextResult = await repository.submitImport({
        gameName: draft.gameName.trim(),
        platform: draft.platform.trim() || undefined,
        version: draft.version.trim() || undefined,
        files,
      })
      setResult(nextResult)
      if (nextResult.status === 'partial') {
        const failedIds = new Set(nextResult.failures.map((failure) => failure.fileId))
        setDraft((current) => current
          ? updateFiles(current, current.files.filter((file) => failedIds.has(file.id)))
          : current)
      }
      if (nextResult.status === 'complete' || nextResult.status === 'partial') await refresh()
    } catch (error) {
      setResult({
        status: 'partial',
        uploaded: 0,
        failures: [],
        message: error instanceof Error ? error.message : '上传失败，请稍后重试',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const submitLabel = repository.mode === 'demo'
    ? '检查配置并上传'
    : `上传 ${draft?.readyFiles.length ?? 0} 张图片`

  return (
    <main className="page upload-page">
      <header className="upload-hero">
        <div>
          <p className="eyebrow">FOLDER IMPORT</p>
          <h1>批量上传</h1>
          <p className="hero-description">按“游戏文件夹 / 模块+中文名-动作步骤”的方式命名，系统会自动整理成可搜索的交互序列。</p>
        </div>
        <div className="upload-rule-card">
          <ShieldCheck size={18} />
          <div><strong>原图保持私有</strong><span>浏览器同时生成 560px WebP 缩略图</span></div>
        </div>
      </header>

      <div className="naming-guide">
        <span>推荐命名</span>
        <code>IDOL / reward奖励-奖励详情.png</code>
        <ArrowRight size={15} />
        <strong>奖励模块 · 奖励详情</strong>
      </div>

      <UploadDropzone onSelect={selectFiles} />

      {draft && (
        <>
          <ImportPreview
            draft={draft}
            onMetaChange={(patch) => setDraft((current) => current ? { ...current, ...patch } : current)}
            onFileChange={changeFile}
            onRemove={removeFile}
          />

          <div className="upload-submit-bar">
            <div>
              <strong>{draft.readyFiles.length} 张图片准备就绪</strong>
              <span>{draft.rejectedFiles.length ? `${draft.rejectedFiles.length} 张不会上传` : '所有文件检查通过'}</span>
            </div>
            <button className="primary-button" type="button" disabled={!draft.readyFiles.length || submitting} onClick={() => void submit()}>
              {submitting ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />}
              {submitting ? '正在处理缩略图…' : submitLabel}
            </button>
          </div>
        </>
      )}

      {result && (
        <div className={`upload-result upload-result--${result.status}`} role="status">
          {result.status === 'complete' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <div>
            <strong>{result.status === 'complete' ? `已完成上传 ${result.uploaded} 张图片` : result.message}</strong>
            {result.status === 'partial' && result.uploaded > 0 && <span>已成功 {result.uploaded} 张，其余文件可稍后重试。</span>}
            {result.status === 'partial' && result.failures.length > 0 && (
              <ul aria-label="上传失败文件">
                {result.failures.map((failure) => (
                  <li key={failure.fileId}>
                    <strong>{failure.fileName}</strong>
                    <span>：{failure.message}</span>
                  </li>
                ))}
              </ul>
            )}
            {result.status === 'unavailable' && <span>预览与资料编辑仍可正常使用。</span>}
          </div>
        </div>
      )}
    </main>
  )
}

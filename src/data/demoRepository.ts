import type {
  ImportSubmission,
  LibraryRepository,
  UploadBatchResult,
} from './libraryRepository'
import { demoSnapshot } from './demoData'

export const demoRepository: LibraryRepository = {
  mode: 'demo',

  async getSnapshot() {
    return structuredClone(demoSnapshot)
  },

  async submitImport(draft: ImportSubmission): Promise<UploadBatchResult> {
    return {
      status: 'unavailable',
      uploaded: 0,
      failures: draft.files.map((file) => ({
        fileId: file.id,
        fileName: file.originalFilename,
        message: '配置 Supabase 后即可保存上传内容',
      })),
      message: '当前为只读演示模式',
    }
  },
}

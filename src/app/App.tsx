import { HashRouter, Route, Routes } from 'react-router-dom'

import { EmptyState } from '../components/EmptyState'
import { demoRepository } from '../data/demoRepository'
import type { LibraryRepository } from '../data/libraryRepository'
import { GamePage } from '../pages/GamePage'
import { LibraryPage } from '../pages/LibraryPage'
import { SearchPage } from '../pages/SearchPage'
import { UploadPage } from '../pages/UploadPage'
import { AppShell } from './AppShell'
import { LibraryProvider } from './LibraryContext'

interface AppProps {
  repository?: LibraryRepository
}

export function App({ repository = demoRepository }: AppProps) {
  return (
    <HashRouter>
      <LibraryProvider repository={repository}>
        <Routes>
          <Route element={<AppShell repositoryMode={repository.mode} />}>
            <Route index element={<LibraryPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="game/:gameId" element={<GamePage />} />
            <Route path="upload" element={<UploadPage />} />
            <Route
              path="settings"
              element={
                <EmptyState
                  eyebrow="SETTINGS"
                  title="设置与备份"
                  description="云端连接和资料导出将在完成后集中放在这里。"
                  actionLabel="返回游戏书架"
                  actionTo="/"
                />
              }
            />
            <Route
              path="*"
              element={
                <EmptyState
                  eyebrow="404"
                  title="没有这个页面"
                  description="地址可能已变化，回到书架继续浏览吧。"
                  actionLabel="返回游戏书架"
                  actionTo="/"
                />
              }
            />
          </Route>
        </Routes>
      </LibraryProvider>
    </HashRouter>
  )
}

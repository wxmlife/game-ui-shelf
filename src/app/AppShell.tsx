import { BookOpen, Cloud, HardDrive, Settings, Upload } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'

import { SearchBox } from '../components/SearchBox'

interface AppShellProps {
  repositoryMode: 'demo' | 'cloud'
}

export function AppShell({ repositoryMode }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/" aria-label="返回 UI Shelf 首页">
          <span className="brand-mark">UI</span>
          <span className="brand-copy">
            <strong>UI Shelf</strong>
            <small>游戏界面参考库</small>
          </span>
        </Link>
        <SearchBox />
        <div className="topbar-actions">
          <span className={`mode-pill mode-pill--${repositoryMode}`}>
            {repositoryMode === 'demo' ? <HardDrive size={14} /> : <Cloud size={14} />}
            {repositoryMode === 'demo' ? '演示资料' : '私有云端'}
          </span>
          <Link className="primary-button primary-button--compact" to="/upload">
            <Upload size={17} />
            上传
          </Link>
        </div>
      </header>

      <aside className="sidebar" aria-label="主导航">
        <nav>
          <NavLink to="/" end>
            <BookOpen size={19} />
            <span>游戏书架</span>
          </NavLink>
          <NavLink to="/upload">
            <Upload size={19} />
            <span>批量上传</span>
          </NavLink>
          <NavLink to="/settings">
            <Settings size={19} />
            <span>设置与备份</span>
          </NavLink>
        </nav>
        <div className="sidebar-note">
          <span className="status-dot" />
          <div>
            <strong>{repositoryMode === 'demo' ? '演示模式' : '云端已连接'}</strong>
            <p>
              {repositoryMode === 'demo'
                ? '配置 Supabase 后即可保存自己的图片。'
                : '原图与资料仅你的账号可见。'}
            </p>
          </div>
        </div>
      </aside>

      <div className="page-stage">
        <Outlet />
      </div>
    </div>
  )
}

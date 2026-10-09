import { Cloud, Database, Download, FolderTree, LogOut, ShieldCheck } from 'lucide-react'

import { useLibrary } from '../app/LibraryContext'
import { downloadLibraryExport } from '../features/backup/exportLibrary'

export function SettingsPage() {
  const { snapshot, loading, error, repository } = useLibrary()

  if (loading) return <div className="page-loading"><span />正在读取资料库设置…</div>

  return (
    <main className="page settings-page">
      <header className="settings-hero">
        <div>
          <p className="eyebrow">LIBRARY SETTINGS</p>
          <h1>设置与备份</h1>
          <p className="hero-description">导出可恢复的资料索引，查看当前运行模式，并保留这套资料库的维护说明。</p>
        </div>
        <span className={`settings-mode settings-mode--${repository.mode}`}>
          {repository.mode === 'cloud' ? <Cloud size={17} /> : <Database size={17} />}
          {repository.mode === 'cloud' ? '私有云端已连接' : '只读演示模式'}
        </span>
      </header>

      {error && <div className="settings-alert">{error}</div>}

      <div className="settings-grid">
        <section className="settings-card settings-card--accent">
          <span className="settings-card-icon"><Download size={20} /></span>
          <p className="eyebrow">BACKUP</p>
          <h2>导出资料索引</h2>
          <p>下载游戏、模块、图片标题、标签与顺序的 JSON。短时图片链接不会写入备份。</p>
          <div className="settings-stats">
            <span><strong>{snapshot?.games.length ?? 0}</strong> 游戏</span>
            <span><strong>{snapshot?.images.length ?? 0}</strong> 图片记录</span>
            <span><strong>{snapshot?.modules.length ?? 0}</strong> 模块</span>
          </div>
          <button className="primary-button" type="button" disabled={!snapshot} onClick={() => snapshot && downloadLibraryExport(snapshot)}>
            <Download size={16} /> 导出 JSON 备份
          </button>
        </section>

        <section className="settings-card">
          <span className="settings-card-icon"><ShieldCheck size={20} /></span>
          <p className="eyebrow">PRIVACY</p>
          <h2>隐私状态</h2>
          <p>{repository.mode === 'cloud'
            ? '元数据受行级权限保护，原图和缩略图位于私有 Bucket，通过短时链接查看。'
            : '当前只读取代码内置演示资料，不会上传或保存你选择的文件。'}</p>
          {repository.signOut && (
            <button className="secondary-button" type="button" onClick={() => void repository.signOut?.()}>
              <LogOut size={16} /> 退出登录
            </button>
          )}
        </section>

        <section className="settings-card settings-card--wide">
          <span className="settings-card-icon"><FolderTree size={20} /></span>
          <p className="eyebrow">NAMING RULES</p>
          <h2>批量导入命名规则</h2>
          <div className="naming-examples">
            <code>IDOL/home首页.png</code>
            <code>IDOL/reward奖励-奖励详情.png</code>
            <code>IDOL/03-reward奖励-奖励领取.png</code>
          </div>
          <p>第一层文件夹是游戏名；拉丁前缀是模块标识；中文是显示名；连字符后是动作步骤；数字前缀可控制顺序。</p>
        </section>
      </div>
    </main>
  )
}

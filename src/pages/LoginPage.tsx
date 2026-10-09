import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { BookOpen, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react'
import { type FormEvent, useState } from 'react'

interface LoginPageProps {
  client: SupabaseClient
  ownerEmail?: string
  initialError?: string | null
  onAuthenticated: (session: Session) => void
}

export function LoginPage({ client, ownerEmail, initialError, onAuthenticated }: LoginPageProps) {
  const [email, setEmail] = useState(ownerEmail ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [submitting, setSubmitting] = useState(false)

  async function signIn(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (ownerEmail && email.trim().toLocaleLowerCase() !== ownerEmail.toLocaleLowerCase()) {
      setError('这个邮箱没有资料库访问权限')
      return
    }

    setSubmitting(true)
    try {
      const { data, error: signInError } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signInError) throw signInError
      if (!data.session) throw new Error('登录成功但未获得有效会话，请重试')
      onAuthenticated(data.session)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '登录失败，请检查邮箱和密码')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-intro">
        <div className="login-brand"><span className="brand-mark">UI</span><strong>UI Shelf</strong></div>
        <div>
          <p className="eyebrow">PRIVATE GAME UI LIBRARY</p>
          <h1>你的游戏界面<br />参考书架</h1>
          <p>按游戏、模块与交互序列整理截图。原图保存在私有存储中，只对这个账号开放。</p>
        </div>
        <ul>
          <li><BookOpen size={16} /><span><strong>书架式浏览</strong>快速进入每个游戏的完整 UI 档案</span></li>
          <li><ShieldCheck size={16} /><span><strong>私有数据</strong>数据库与图片都受账号权限保护</span></li>
          <li><LockKeyhole size={16} /><span><strong>单用户入口</strong>没有公开注册、投稿或社交功能</span></li>
        </ul>
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={(event) => void signIn(event)}>
          <span className="login-icon"><KeyRound size={22} /></span>
          <p className="eyebrow">WELCOME BACK</p>
          <h2>登录私人资料库</h2>
          <p>使用你在 Supabase 中预先创建的账号。</p>
          <label>
            <span>邮箱</span>
            <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            <span>密码</span>
            <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting && <LoaderCircle className="spin" size={16} />}
            {submitting ? '正在登录…' : '进入资料库'}
          </button>
          <small>本站不提供注册入口；请在 Supabase 控制台管理唯一账号。</small>
        </form>
      </section>
    </main>
  )
}

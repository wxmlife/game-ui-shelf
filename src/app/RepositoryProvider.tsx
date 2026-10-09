import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { type ReactNode, useEffect, useMemo, useState } from 'react'

import { resolveRuntimeConfig, type RuntimeConfig } from '../config/runtime'
import { demoRepository } from '../data/demoRepository'
import type { LibraryRepository } from '../data/libraryRepository'
import { SupabaseLibraryRepository } from '../data/supabaseRepository'
import { createBrowserSupabaseClient } from '../lib/supabase'
import { LoginPage } from '../pages/LoginPage'

interface RepositoryProviderProps {
  children: (repository: LibraryRepository) => ReactNode
  config?: RuntimeConfig
  client?: SupabaseClient
}

export function RepositoryProvider({ children, config, client }: RepositoryProviderProps) {
  const runtime = useMemo(() => config ?? resolveRuntimeConfig({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
    VITE_OWNER_EMAIL: import.meta.env.VITE_OWNER_EMAIL,
  }), [config])
  const browserClient = useMemo(() => {
    if (runtime.mode !== 'cloud') return null
    return client ?? createBrowserSupabaseClient(runtime)
  }, [client, runtime])
  const [session, setSession] = useState<Session | null | undefined>(
    runtime.mode === 'cloud' ? undefined : null,
  )
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    if (runtime.mode !== 'cloud' || !browserClient) return
    const authClient = browserClient
    let active = true

    function applySession(nextSession: Session | null) {
      if (!active) return
      const expectedEmail = runtime.ownerEmail?.toLocaleLowerCase()
      const actualEmail = nextSession?.user.email?.toLocaleLowerCase()
      if (nextSession && expectedEmail && actualEmail !== expectedEmail) {
        setAuthError('当前账号没有这个资料库的访问权限')
        setSession(null)
        void authClient.auth.signOut()
        return
      }
      setAuthError(null)
      setSession(nextSession)
    }

    void authClient.auth.getSession().then(({ data, error }) => {
      if (error) {
        if (active) {
          setAuthError(error.message)
          setSession(null)
        }
        return
      }
      applySession(data.session)
    })
    const { data } = authClient.auth.onAuthStateChange((_event, nextSession) => applySession(nextSession))

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [browserClient, runtime])

  const cloudRepository = useMemo(
    () => browserClient && session ? new SupabaseLibraryRepository(browserClient) : null,
    [browserClient, session],
  )

  if (runtime.mode === 'demo') return children(demoRepository)
  if (runtime.mode === 'invalid') {
    return (
      <main className="config-error-page">
        <p className="eyebrow">CONFIGURATION REQUIRED</p>
        <h1>云端配置不完整</h1>
        <p>{runtime.message}</p>
        <code>请同时配置 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY</code>
      </main>
    )
  }
  if (!browserClient || session === undefined) {
    return <div className="page-loading page-loading--fullscreen"><span />正在检查私人会话…</div>
  }
  if (!session || !cloudRepository) {
    return (
      <LoginPage
        client={browserClient}
        ownerEmail={runtime.ownerEmail}
        initialError={authError}
        onAuthenticated={setSession}
      />
    )
  }

  return children(cloudRepository)
}

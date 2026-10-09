import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CloudRuntimeConfig } from '../config/runtime'
import { RepositoryProvider } from './RepositoryProvider'

const cloudConfig: CloudRuntimeConfig = {
  mode: 'cloud',
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'public-key',
  ownerEmail: 'owner@example.com',
}

describe('RepositoryProvider', () => {
  it('shows the login gate instead of private content when cloud mode has no session', async () => {
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      },
    }

    render(
      <RepositoryProvider config={cloudConfig} client={client as never}>
        {() => <div>private library</div>}
      </RepositoryProvider>,
    )

    expect(await screen.findByRole('heading', { name: '登录私人资料库' })).toBeInTheDocument()
    expect(screen.queryByText('private library')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /注册/ })).not.toBeInTheDocument()
  })

  it('surfaces incomplete cloud configuration instead of exposing a broken app', () => {
    render(
      <RepositoryProvider config={{ mode: 'invalid', missing: ['VITE_SUPABASE_ANON_KEY'], message: 'Supabase 配置不完整：缺少 VITE_SUPABASE_ANON_KEY' }}>
        {() => <div>private library</div>}
      </RepositoryProvider>,
    )

    expect(screen.getByRole('heading', { name: '云端配置不完整' })).toBeInTheDocument()
    expect(screen.getByText('Supabase 配置不完整：缺少 VITE_SUPABASE_ANON_KEY')).toBeInTheDocument()
  })
})

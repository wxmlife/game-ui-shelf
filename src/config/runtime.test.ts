import { describe, expect, it } from 'vitest'

import { resolveRuntimeConfig } from './runtime'

describe('resolveRuntimeConfig', () => {
  it('uses read-only demo mode when Supabase is not configured', () => {
    expect(resolveRuntimeConfig({})).toEqual({
      mode: 'demo',
    })
  })

  it('returns cloud mode when both Supabase values are configured', () => {
    expect(
      resolveRuntimeConfig({
        VITE_SUPABASE_URL: ' https://example.supabase.co ',
        VITE_SUPABASE_ANON_KEY: ' public-anon-key ',
        VITE_OWNER_EMAIL: ' owner@example.com ',
      }),
    ).toEqual({
      mode: 'cloud',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'public-anon-key',
      ownerEmail: 'owner@example.com',
    })
  })

  it.each([
    {
      env: { VITE_SUPABASE_URL: 'https://example.supabase.co' },
      missing: ['VITE_SUPABASE_ANON_KEY'],
    },
    {
      env: { VITE_SUPABASE_ANON_KEY: 'public-anon-key' },
      missing: ['VITE_SUPABASE_URL'],
    },
  ])('returns an explicit invalid state for a partial configuration', ({ env, missing }) => {
    expect(resolveRuntimeConfig(env)).toEqual({
      mode: 'invalid',
      missing,
      message: `Supabase 配置不完整：缺少 ${missing.join('、')}`,
    })
  })

  it('treats whitespace-only Supabase values as missing', () => {
    expect(
      resolveRuntimeConfig({
        VITE_SUPABASE_URL: '   ',
        VITE_SUPABASE_ANON_KEY: '\n',
        VITE_OWNER_EMAIL: ' owner@example.com ',
      }),
    ).toEqual({
      mode: 'demo',
      ownerEmail: 'owner@example.com',
    })
  })
})

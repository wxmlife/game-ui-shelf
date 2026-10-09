export interface RuntimeEnvironment {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  VITE_OWNER_EMAIL?: string
}

interface RuntimeConfigBase {
  ownerEmail?: string
}

export interface DemoRuntimeConfig extends RuntimeConfigBase {
  mode: 'demo'
}

export interface CloudRuntimeConfig extends RuntimeConfigBase {
  mode: 'cloud'
  supabaseUrl: string
  supabaseAnonKey: string
}

export interface InvalidRuntimeConfig extends RuntimeConfigBase {
  mode: 'invalid'
  missing: Array<'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY'>
  message: string
}

export type RuntimeConfig =
  | DemoRuntimeConfig
  | CloudRuntimeConfig
  | InvalidRuntimeConfig

function clean(value: string | undefined) {
  const normalized = value?.trim()
  return normalized || undefined
}

export function resolveRuntimeConfig(env: RuntimeEnvironment): RuntimeConfig {
  const supabaseUrl = clean(env.VITE_SUPABASE_URL)
  const supabaseAnonKey = clean(env.VITE_SUPABASE_ANON_KEY)
  const ownerEmail = clean(env.VITE_OWNER_EMAIL)
  const owner = ownerEmail ? { ownerEmail } : {}

  if (!supabaseUrl && !supabaseAnonKey) {
    return { mode: 'demo', ...owner }
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    const missing: InvalidRuntimeConfig['missing'] = []
    if (!supabaseUrl) missing.push('VITE_SUPABASE_URL')
    if (!supabaseAnonKey) missing.push('VITE_SUPABASE_ANON_KEY')

    return {
      mode: 'invalid',
      missing,
      message: `Supabase 配置不完整：缺少 ${missing.join('、')}`,
      ...owner,
    }
  }

  return {
    mode: 'cloud',
    supabaseUrl,
    supabaseAnonKey,
    ...owner,
  }
}

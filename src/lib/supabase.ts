import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { CloudRuntimeConfig } from '../config/runtime'

export function createBrowserSupabaseClient(config: CloudRuntimeConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })
}

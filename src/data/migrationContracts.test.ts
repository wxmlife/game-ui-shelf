import { describe, expect, it } from 'vitest'
import migration from '../../supabase/migrations/202610160007_image_placement_and_cover_focus.sql?raw'

function lastFunctionDefinition(name: string) {
  const marker = `create or replace function public.${name}(`
  const start = migration.lastIndexOf(marker)
  if (start < 0) throw new Error(`Missing migration function: ${name}`)
  const end = migration.indexOf('\n$$;', start)
  if (end < 0) throw new Error(`Unterminated migration function: ${name}`)
  return migration.slice(start, end + '\n$$;'.length)
}

describe('007 migration contracts', () => {
  it('sets a cover and its focal point in one non-swallowing transaction', () => {
    const atomic = lastFunctionDefinition('set_game_cover_from_image_with_focus')
    const legacy = lastFunctionDefinition('set_game_cover_from_image')
    const setFocus = atomic.indexOf('perform public.update_game_cover_focus(')
    const lockGame = atomic.indexOf('select * into v_game')
    const lockImage = atomic.indexOf('select * into v_image')

    expect(atomic).not.toContain('perform public.set_game_cover_from_image(')
    expect(setFocus).toBeGreaterThan(0)
    expect(lockGame).toBeGreaterThan(setFocus)
    expect(lockImage).toBeGreaterThan(lockGame)
    expect(atomic).toContain('insert into public.storage_cleanup_queue (owner_id, bucket, path)')
    expect(atomic).not.toMatch(/exception\s+when/i)
    expect(legacy).toContain('perform public.set_game_cover_from_image_with_focus(')
    expect(legacy).toMatch(/p_cover_thumbnail_path,\s*50,\s*50/i)
    expect(legacy.indexOf('return;')).toBeLessThan(legacy.indexOf('perform public.set_game_cover_from_image_with_focus('))
    expect(migration).toContain(
      'revoke all on function public.set_game_cover_from_image_with_focus(\n' +
      '  uuid, uuid, text, double precision, double precision\n' +
      ') from public, anon;',
    )
    expect(migration).toContain(
      'grant execute on function public.set_game_cover_from_image_with_focus(\n' +
      '  uuid, uuid, text, double precision, double precision\n' +
      ') to authenticated;',
    )
  })

  it('keeps metadata edits atomic without allowing either RPC to rewrite ordering', () => {
    const current = lastFunctionDefinition('update_ui_image_metadata_without_order')
    const legacy = lastFunctionDefinition('update_ui_image_metadata_with_tags')

    expect(current).not.toContain('p_sequence_order')
    expect(current).not.toMatch(/sequence_order\s*=/i)
    const discoverImage = current.indexOf('select game_id, module_id into v_game_id, v_existing_module_id')
    const lockGame = current.indexOf('from public.games', discoverImage)
    const lockModule = current.indexOf('from public.modules', lockGame)
    const lockImage = current.indexOf('for update;', lockModule)
    const mutateFlow = current.indexOf('insert into public.flows', lockImage)
    expect(discoverImage).toBeGreaterThan(0)
    expect(lockGame).toBeGreaterThan(discoverImage)
    expect(current.slice(lockGame, lockModule)).toContain('for update;')
    expect(lockModule).toBeGreaterThan(lockGame)
    expect(current.slice(lockModule, lockImage)).toContain('for key share;')
    expect(lockImage).toBeGreaterThan(lockModule)
    expect(mutateFlow).toBeGreaterThan(lockImage)
    expect(current).toContain('if v_existing_module_id is distinct from p_module_id then')
    expect(legacy).toContain('perform public.update_ui_image_metadata_without_order(')
    expect(legacy.slice(legacy.indexOf('as $$'))).not.toContain('p_sequence_order')
    expect(legacy).not.toMatch(/sequence_order\s*=/i)
    expect(migration).toContain(
      'revoke all on function public.update_ui_image_metadata_without_order(\n' +
      '  uuid, uuid, text, text, text, text[]\n' +
      ') from public, anon;',
    )
  })

  it('removes direct flow deletion so every image/flow mutation can share the game-first lock order', () => {
    expect(migration).toMatch(/revoke\s+delete\s+on\s+table\s+public\.flows\s+from\s+authenticated\s*;/i)
  })

  it('keeps the legacy move endpoint and delegates cross-module appends to placement', () => {
    const legacyMove = lastFunctionDefinition('move_ui_image_to_module')

    expect(legacyMove).toMatch(/if\s+v_current_module_id\s*=\s*p_target_module_id\s+then\s+return;/i)
    expect(legacyMove).toContain('perform public.place_ui_image(p_image_id, p_target_module_id, null);')
    expect(migration).toContain(
      'grant execute on function public.move_ui_image_to_module(uuid, uuid) to authenticated;',
    )
  })
})

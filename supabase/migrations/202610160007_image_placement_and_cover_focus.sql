-- One placement operation powers both module-local reordering and precise
-- cross-module moves. A game-row lock serializes placements for that game,
-- while the lack of a sequence uniqueness constraint keeps uploads tolerant
-- of temporarily duplicated user-provided sequence numbers.
create or replace function public.place_ui_image(
  p_image_id uuid,
  p_target_module_id uuid,
  p_before_image_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_game_id uuid;
  v_image public.ui_images%rowtype;
  v_target public.modules%rowtype;
  v_source_module_id uuid;
  v_flow_name text;
  v_target_flow_id uuid;
  v_game_name text;
  v_platform text;
  v_version text;
  v_tags text;
  v_target_position integer;
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Discover the owning game, then use its row as the common lock for every
  -- placement in that game.
  select game_id into v_game_id
  from public.ui_images
  where id = p_image_id and owner_id = v_owner_id;
  if not found then
    raise exception 'Image not found' using errcode = 'P0002';
  end if;

  select name into v_game_name
  from public.games
  where id = v_game_id and owner_id = v_owner_id
  for update;
  if not found then
    raise exception 'Game not found' using errcode = 'P0002';
  end if;

  -- Resolve the current source only after taking the game lock: another
  -- placement may have completed while this transaction was waiting.
  select module_id into v_source_module_id
  from public.ui_images
  where id = p_image_id and owner_id = v_owner_id and game_id = v_game_id;
  if not found then
    raise exception 'Image not found' using errcode = 'P0002';
  end if;

  -- Match module deletion's module-before-image lock order. KEY SHARE is
  -- enough to prevent deletion while remaining compatible with the same lock
  -- acquired by concurrent flow foreign-key checks. Deterministic IDs also
  -- prevent two-module placements from taking opposite module locks.
  perform 1
  from public.modules
  where owner_id = v_owner_id
    and game_id = v_game_id
    and id in (v_source_module_id, p_target_module_id)
  order by id
  for key share;
  select * into v_target
  from public.modules
  where id = p_target_module_id
    and owner_id = v_owner_id
    and game_id = v_game_id;
  if not found then
    raise exception 'Target module must belong to the same game' using errcode = '23514';
  end if;

  -- delete_ui_images locks its UUID-sorted input one row at a time. Acquire
  -- every potentially rewritten row in that same order before taking any
  -- individual image lock, avoiding B→A versus A→B deadlocks.
  perform 1
  from public.ui_images
  where owner_id = v_owner_id
    and game_id = v_game_id
    and module_id in (v_source_module_id, p_target_module_id)
  order by id
  for update;
  select * into v_image
  from public.ui_images
  where id = p_image_id
    and owner_id = v_owner_id
    and game_id = v_game_id
    and module_id = v_source_module_id;
  if not found then
    raise exception 'Image not found' using errcode = 'P0002';
  end if;

  if p_before_image_id = p_image_id then
    raise exception 'An image cannot be placed before itself' using errcode = '22023';
  end if;
  if p_before_image_id is not null then
    perform 1
    from public.ui_images
    where id = p_before_image_id
      and owner_id = v_owner_id
      and game_id = v_game_id
      and module_id = p_target_module_id
    for update;
    if not found then
      raise exception 'Before image must belong to the target module in the same game' using errcode = '23514';
    end if;
  end if;

  -- Keep the flow meaning when crossing modules. Each module owns its flow
  -- rows, so reuse/create the same flow name in the destination module.
  if v_image.flow_id is not null then
    select name into v_flow_name
    from public.flows
    where id = v_image.flow_id and owner_id = v_owner_id;

    if v_source_module_id = p_target_module_id then
      v_target_flow_id := v_image.flow_id;
    elsif v_flow_name is not null then
      insert into public.flows (owner_id, module_id, name, sort_order)
      select v_owner_id, p_target_module_id, v_flow_name,
        coalesce(max(sort_order), -1) + 1
      from public.flows
      where owner_id = v_owner_id and module_id = p_target_module_id
      on conflict (owner_id, module_id, name) do nothing;

      select id into v_target_flow_id
      from public.flows
      where owner_id = v_owner_id
        and module_id = p_target_module_id
        and name = v_flow_name;
    end if;
  end if;

  -- Remove the moving image from its current ordering and deterministically
  -- normalize the remaining source positions.
  with ordered as (
    select id,
      pg_catalog.row_number() over (
        order by sequence_order, created_at, id
      )::integer as next_sequence
    from public.ui_images
    where owner_id = v_owner_id
      and game_id = v_game_id
      and module_id = v_source_module_id
      and id <> p_image_id
  )
  update public.ui_images as image
  set sequence_order = ordered.next_sequence
  from ordered
  where image.id = ordered.id
    and image.owner_id = v_owner_id;

  -- A cross-module destination has not been normalized by the source pass.
  if v_source_module_id <> p_target_module_id then
    with ordered as (
      select id,
        pg_catalog.row_number() over (
          order by sequence_order, created_at, id
        )::integer as next_sequence
      from public.ui_images
      where owner_id = v_owner_id
        and game_id = v_game_id
        and module_id = p_target_module_id
    )
    update public.ui_images as image
    set sequence_order = ordered.next_sequence
    from ordered
    where image.id = ordered.id
      and image.owner_id = v_owner_id;
  end if;

  if p_before_image_id is null then
    select pg_catalog.count(*)::integer + 1 into v_target_position
    from public.ui_images
    where owner_id = v_owner_id
      and game_id = v_game_id
      and module_id = p_target_module_id
      and id <> p_image_id;
  else
    select sequence_order into v_target_position
    from public.ui_images
    where id = p_before_image_id
      and owner_id = v_owner_id
      and game_id = v_game_id
      and module_id = p_target_module_id;
  end if;

  update public.ui_images
  set sequence_order = sequence_order + 1
  where owner_id = v_owner_id
    and game_id = v_game_id
    and module_id = p_target_module_id
    and id <> p_image_id
    and sequence_order >= v_target_position;

  select platform, version into v_platform, v_version
  from public.capture_sets
  where id = v_image.capture_set_id and owner_id = v_owner_id;
  select pg_catalog.string_agg(tag.name, ' ' order by tag.name) into v_tags
  from public.image_tags as image_tag
  join public.tags as tag
    on tag.id = image_tag.tag_id and tag.owner_id = image_tag.owner_id
  where image_tag.image_id = p_image_id and image_tag.owner_id = v_owner_id;

  update public.ui_images
  set module_id = p_target_module_id,
      flow_id = v_target_flow_id,
      sequence_order = v_target_position,
      search_text = pg_catalog.concat_ws(' ',
        v_game_name, v_target.key, v_target.name, v_image.title,
        v_flow_name, v_platform, v_version, v_tags
      ),
      updated_at = pg_catalog.now()
  where id = p_image_id and owner_id = v_owner_id;
end;
$$;

-- Preserve the original RPC for older deployed clients. Its historical
-- same-module behavior was a no-op; cross-module moves still append.
create or replace function public.move_ui_image_to_module(
  p_image_id uuid,
  p_target_module_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_current_module_id uuid;
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select module_id into v_current_module_id
  from public.ui_images
  where id = p_image_id and owner_id = v_owner_id;
  if not found then
    raise exception 'Image not found' using errcode = 'P0002';
  end if;
  if v_current_module_id = p_target_module_id then
    return;
  end if;

  perform public.place_ui_image(p_image_id, p_target_module_id, null);
end;
$$;

alter table public.games
  add column cover_focus_x double precision not null default 50,
  add column cover_focus_y double precision not null default 50,
  add constraint games_cover_focus_x_check check (cover_focus_x between 0 and 100),
  add constraint games_cover_focus_y_check check (cover_focus_y between 0 and 100);

create or replace function public.update_game_cover_focus(
  p_game_id uuid,
  p_focus_x double precision,
  p_focus_y double precision
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_focus_x is null
    or p_focus_y is null
    or p_focus_x::text in ('NaN', 'Infinity', '-Infinity')
    or p_focus_y::text in ('NaN', 'Infinity', '-Infinity')
    or not (p_focus_x between 0 and 100)
    or not (p_focus_y between 0 and 100) then
    raise exception 'Cover focus must be between 0 and 100' using errcode = '22023';
  end if;

  perform 1
  from public.games
  where id = p_game_id and owner_id = v_owner_id
  for update;
  if not found then
    raise exception 'Game not found' using errcode = 'P0002';
  end if;

  update public.games
  set cover_focus_x = p_focus_x,
      cover_focus_y = p_focus_y,
      updated_at = pg_catalog.now()
  where id = p_game_id and owner_id = v_owner_id;
end;
$$;

-- Changing the selected screenshot and its crop must be one database commit.
-- This is the canonical implementation: it locks game then image, validates
-- the independent Storage copy, switches cover/focus, and durably queues the
-- obsolete cover objects. The legacy three-argument endpoint below delegates
-- here with a centered focus rather than creating a reverse call cycle.
create or replace function public.set_game_cover_from_image_with_focus(
  p_game_id uuid,
  p_image_id uuid,
  p_cover_thumbnail_path text,
  p_focus_x double precision,
  p_focus_y double precision
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_game public.games%rowtype;
  v_image public.ui_images%rowtype;
  v_game_prefix text;
  v_cover_prefix text;
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Validate focus and take the common game lock before touching the image.
  -- Any later error rolls this update back with the cover and cleanup queue.
  perform public.update_game_cover_focus(
    p_game_id,
    p_focus_x,
    p_focus_y
  );

  select * into v_game
  from public.games
  where id = p_game_id and owner_id = v_owner_id
  for update;
  if not found then
    raise exception 'Game not found' using errcode = 'P0002';
  end if;

  select * into v_image
  from public.ui_images
  where id = p_image_id and owner_id = v_owner_id and game_id = p_game_id
  for update;
  if not found then
    raise exception 'Image not found in this game' using errcode = 'P0002';
  end if;

  v_game_prefix := v_owner_id::text || '/' || p_game_id::text || '/';
  v_cover_prefix := v_game_prefix || 'covers/';
  if v_image.thumbnail_path is null
    or pg_catalog.left(v_image.thumbnail_path, pg_catalog.length(v_game_prefix)) <> v_game_prefix then
    raise exception 'Image has no thumbnail in this game' using errcode = '23514';
  end if;
  if p_cover_thumbnail_path is null
    or pg_catalog.left(p_cover_thumbnail_path, pg_catalog.length(v_cover_prefix)) <> v_cover_prefix
    or pg_catalog.substr(p_cover_thumbnail_path, pg_catalog.length(v_cover_prefix) + 1)
      !~ '^[a-zA-Z0-9-]+/thumbnail\.[a-z0-9]{1,10}$'
    or p_cover_thumbnail_path = v_image.thumbnail_path then
    raise exception 'Cover path must be a separate object in this game cover directory' using errcode = '23514';
  end if;

  -- A replay may still repair the requested focus, but must never queue the
  -- active cover as obsolete.
  if v_game.cover_thumbnail_path = p_cover_thumbnail_path then
    return;
  end if;
  if exists (
    select 1 from public.storage_cleanup_queue
    where owner_id = v_owner_id and bucket = 'game-ui-thumbnails' and path = p_cover_thumbnail_path
  ) or exists (
    select 1 from public.ui_images
    where owner_id = v_owner_id and thumbnail_path = p_cover_thumbnail_path
  ) or exists (
    select 1 from public.games
    where owner_id = v_owner_id and id <> p_game_id and cover_thumbnail_path = p_cover_thumbnail_path
  ) then
    raise exception 'Cover copy is already referenced or pending cleanup' using errcode = '23514';
  end if;

  perform 1 from storage.objects
  where bucket_id = 'game-ui-thumbnails' and name = p_cover_thumbnail_path
  for share;
  if not found then
    raise exception 'Cover copy not found' using errcode = 'P0002';
  end if;

  update public.games
  set cover_thumbnail_path = p_cover_thumbnail_path,
      cover_original_path = null
  where id = p_game_id and owner_id = v_owner_id;

  -- Legacy cover paths can alias existing screenshots. Preserve those shared
  -- objects and never enqueue a path outside this owner's game directory.
  if v_game.cover_original_path is not null
    and pg_catalog.left(v_game.cover_original_path, pg_catalog.length(v_game_prefix)) = v_game_prefix
    and not exists (
      select 1 from public.ui_images
      where owner_id = v_owner_id and original_path = v_game.cover_original_path
    ) and not exists (
      select 1 from public.games
      where owner_id = v_owner_id and id <> p_game_id and cover_original_path = v_game.cover_original_path
    ) then
    insert into public.storage_cleanup_queue (owner_id, bucket, path)
    values (v_owner_id, 'game-ui-originals', v_game.cover_original_path)
    on conflict (owner_id, bucket, path) do nothing;
  end if;
  if v_game.cover_thumbnail_path is not null
    and pg_catalog.left(v_game.cover_thumbnail_path, pg_catalog.length(v_game_prefix)) = v_game_prefix
    and not exists (
      select 1 from public.ui_images
      where owner_id = v_owner_id and thumbnail_path = v_game.cover_thumbnail_path
    ) and not exists (
      select 1 from public.games
      where owner_id = v_owner_id and id <> p_game_id and cover_thumbnail_path = v_game.cover_thumbnail_path
    ) then
    insert into public.storage_cleanup_queue (owner_id, bucket, path)
    values (v_owner_id, 'game-ui-thumbnails', v_game.cover_thumbnail_path)
    on conflict (owner_id, bucket, path) do nothing;
  end if;
end;
$$;

-- Old clients remain callable. A real cover replacement starts centered;
-- replaying an already-active path remains a no-op and preserves its focus.
create or replace function public.set_game_cover_from_image(
  p_game_id uuid,
  p_image_id uuid,
  p_cover_thumbnail_path text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_current_cover_path text;
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select cover_thumbnail_path into v_current_cover_path
  from public.games
  where id = p_game_id and owner_id = v_owner_id
  for update;
  if not found then
    raise exception 'Game not found' using errcode = 'P0002';
  end if;
  if v_current_cover_path = p_cover_thumbnail_path then
    return;
  end if;

  perform public.set_game_cover_from_image_with_focus(
    p_game_id,
    p_image_id,
    p_cover_thumbnail_path,
    50,
    50
  );
end;
$$;

-- Metadata edits deliberately do not accept a sequence value. Placement is
-- owned exclusively by place_ui_image so a stale edit dialog cannot undo a
-- reorder that committed while the dialog was open.
create or replace function public.update_ui_image_metadata_without_order(
  p_image_id uuid,
  p_module_id uuid,
  p_title text,
  p_flow_name text,
  p_search_text text,
  p_tags text[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_game_id uuid;
  v_existing_module_id uuid;
  v_locked_game_id uuid;
  v_locked_module_id uuid;
  v_flow_id uuid;
  v_tag_name text;
  v_tag_id uuid;
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Discover the parent without a row lock so every mutating path can start
  -- its real lock sequence from the common game row.
  select game_id, module_id into v_game_id, v_existing_module_id
  from public.ui_images
  where id = p_image_id and owner_id = v_owner_id;
  if not found then
    raise exception 'Image not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.games
  where id = v_game_id and owner_id = v_owner_id
  for update;
  if not found then
    raise exception 'Game not found' using errcode = 'P0002';
  end if;

  -- A placement may have committed while this transaction waited for the
  -- game. Refresh the module, then protect it from parent deletion before
  -- locking and revalidating the image itself.
  select module_id into v_existing_module_id
  from public.ui_images
  where id = p_image_id and owner_id = v_owner_id and game_id = v_game_id;
  if not found then
    raise exception 'Image not found' using errcode = 'P0002';
  end if;
  if v_existing_module_id is distinct from p_module_id then
    raise exception 'Image module mismatch' using errcode = '23514';
  end if;

  perform 1
  from public.modules
  where id = v_existing_module_id
    and owner_id = v_owner_id
    and game_id = v_game_id
  for key share;
  if not found then
    raise exception 'Image module mismatch' using errcode = '23514';
  end if;

  select game_id, module_id into v_locked_game_id, v_locked_module_id
  from public.ui_images
  where id = p_image_id and owner_id = v_owner_id
  for update;
  if not found then
    raise exception 'Image not found' using errcode = 'P0002';
  end if;
  if v_locked_game_id is distinct from v_game_id
    or v_locked_module_id is distinct from v_existing_module_id then
    raise exception 'Image ownership changed during metadata update' using errcode = '40001';
  end if;

  if btrim(coalesce(p_flow_name, '')) <> '' then
    insert into public.flows (owner_id, module_id, name, sort_order)
    values (v_owner_id, p_module_id, btrim(p_flow_name), 0)
    on conflict do nothing;

    select id into v_flow_id
    from public.flows
    where owner_id = v_owner_id
      and module_id = p_module_id
      and name = btrim(p_flow_name)
    limit 1;
  end if;

  update public.ui_images
  set title = btrim(p_title),
      flow_id = v_flow_id,
      search_text = coalesce(p_search_text, '')
  where id = p_image_id and owner_id = v_owner_id;

  delete from public.image_tags
  where image_id = p_image_id and owner_id = v_owner_id;

  for v_tag_name in
    select min(btrim(input.tag_name))
    from unnest(coalesce(p_tags, '{}'::text[])) as input(tag_name)
    where btrim(input.tag_name) <> ''
    group by lower(btrim(input.tag_name))
    order by lower(btrim(input.tag_name))
  loop
    insert into public.tags (owner_id, name)
    values (v_owner_id, v_tag_name)
    on conflict do nothing;

    v_tag_id := null;
    select id into v_tag_id
    from public.tags
    where owner_id = v_owner_id
      and lower(btrim(name)) = lower(v_tag_name)
    limit 1;

    if v_tag_id is null then
      raise exception 'Unable to resolve tag %', v_tag_name;
    end if;

    insert into public.image_tags (owner_id, image_id, tag_id)
    values (v_owner_id, p_image_id, v_tag_id)
    on conflict do nothing;
  end loop;
end;
$$;

-- Keep the deployed seven-argument endpoint callable, but make its legacy
-- ordering argument inert. Older clients still save metadata without being
-- able to reintroduce duplicate or stale positions.
create or replace function public.update_ui_image_metadata_with_tags(
  p_image_id uuid,
  p_module_id uuid,
  p_title text,
  p_flow_name text,
  p_sequence_order integer,
  p_search_text text,
  p_tags text[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.update_ui_image_metadata_without_order(
    p_image_id,
    p_module_id,
    p_title,
    p_flow_name,
    p_search_text,
    p_tags
  );
end;
$$;

-- A direct flow DELETE locks the flow before ON DELETE SET NULL locks its
-- images, the reverse of place_ui_image. There is no standalone flow-delete
-- product action, so keep parent cascades and require any future action to use
-- a game-first RPC instead of restoring this table privilege.
revoke delete on table public.flows from authenticated;

revoke all on function public.place_ui_image(uuid, uuid, uuid) from public, anon;
grant execute on function public.place_ui_image(uuid, uuid, uuid) to authenticated;
revoke all on function public.move_ui_image_to_module(uuid, uuid) from public, anon;
grant execute on function public.move_ui_image_to_module(uuid, uuid) to authenticated;
revoke all on function public.update_game_cover_focus(uuid, double precision, double precision) from public, anon;
grant execute on function public.update_game_cover_focus(uuid, double precision, double precision) to authenticated;
revoke all on function public.set_game_cover_from_image_with_focus(
  uuid, uuid, text, double precision, double precision
) from public, anon;
grant execute on function public.set_game_cover_from_image_with_focus(
  uuid, uuid, text, double precision, double precision
) to authenticated;
revoke all on function public.set_game_cover_from_image(uuid, uuid, text) from public, anon;
grant execute on function public.set_game_cover_from_image(uuid, uuid, text) to authenticated;
revoke all on function public.update_ui_image_metadata_without_order(
  uuid, uuid, text, text, text, text[]
) from public, anon;
grant execute on function public.update_ui_image_metadata_without_order(
  uuid, uuid, text, text, text, text[]
) to authenticated;
revoke all on function public.update_ui_image_metadata_with_tags(
  uuid, uuid, text, text, integer, text, text[]
) from public, anon;
grant execute on function public.update_ui_image_metadata_with_tags(
  uuid, uuid, text, text, integer, text, text[]
) to authenticated;

-- A fingerprint identifies one source file inside one game. Re-importing the
-- same folder should converge on the existing row instead of surfacing a 409,
-- while the same source image may still be catalogued under another game.
create unique index if not exists ui_images_owner_game_fingerprint_key
  on public.ui_images (owner_id, game_id, fingerprint)
  where fingerprint is not null;

-- Build the replacement first so running this file through a statement-based
-- SQL editor never creates a window without duplicate protection.
drop index if exists public.ui_images_owner_fingerprint_key;

create or replace function public.create_ui_image_with_tags(
  p_game_id uuid,
  p_capture_set_id uuid,
  p_module_id uuid,
  p_flow_id uuid,
  p_title text,
  p_original_filename text,
  p_original_path text,
  p_thumbnail_path text,
  p_mime_type text,
  p_width integer,
  p_height integer,
  p_file_size_bytes bigint,
  p_sequence_order integer,
  p_fingerprint text,
  p_search_text text,
  p_tags text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_image_id uuid;
  v_tag_name text;
  v_tag_id uuid;
  v_game_prefix text;
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_fingerprint, '')), '') is null then
    raise exception 'Image fingerprint is required' using errcode = '22023';
  end if;

  insert into public.ui_images (
    owner_id,
    game_id,
    capture_set_id,
    module_id,
    flow_id,
    title,
    original_filename,
    original_path,
    thumbnail_path,
    mime_type,
    width,
    height,
    file_size_bytes,
    sequence_order,
    fingerprint,
    search_text
  ) values (
    v_owner_id,
    p_game_id,
    p_capture_set_id,
    p_module_id,
    p_flow_id,
    btrim(p_title),
    p_original_filename,
    p_original_path,
    p_thumbnail_path,
    coalesce(nullif(p_mime_type, ''), 'application/octet-stream'),
    greatest(coalesce(p_width, 0), 0),
    greatest(coalesce(p_height, 0), 0),
    greatest(coalesce(p_file_size_bytes, 0), 0),
    coalesce(p_sequence_order, 0),
    p_fingerprint,
    coalesce(p_search_text, '')
  )
  on conflict (owner_id, game_id, fingerprint)
    where fingerprint is not null
    do nothing
  returning id into v_image_id;

  if v_image_id is null then
    select id into v_image_id
    from public.ui_images
    where owner_id = v_owner_id
      and game_id = p_game_id
      and fingerprint = p_fingerprint
    limit 1;

    if v_image_id is null then
      raise exception 'Unable to resolve existing image';
    end if;

    -- The caller already uploaded these randomly named objects. Queue only
    -- unreferenced paths inside this game; the normal cleanup worker removes
    -- them without risking an existing image or cover.
    v_game_prefix := v_owner_id::text || '/' || p_game_id::text || '/';
    if p_original_path is not null
      and pg_catalog.left(p_original_path, pg_catalog.length(v_game_prefix)) = v_game_prefix
      and not exists (
        select 1 from public.ui_images
        where owner_id = v_owner_id and original_path = p_original_path
      )
      and not exists (
        select 1 from public.games
        where owner_id = v_owner_id and cover_original_path = p_original_path
      ) then
      insert into public.storage_cleanup_queue (owner_id, bucket, path)
      values (v_owner_id, 'game-ui-originals', p_original_path)
      on conflict (owner_id, bucket, path) do nothing;
    end if;
    if p_thumbnail_path is not null
      and pg_catalog.left(p_thumbnail_path, pg_catalog.length(v_game_prefix)) = v_game_prefix
      and not exists (
        select 1 from public.ui_images
        where owner_id = v_owner_id and thumbnail_path = p_thumbnail_path
      )
      and not exists (
        select 1 from public.games
        where owner_id = v_owner_id and cover_thumbnail_path = p_thumbnail_path
      ) then
      insert into public.storage_cleanup_queue (owner_id, bucket, path)
      values (v_owner_id, 'game-ui-thumbnails', p_thumbnail_path)
      on conflict (owner_id, bucket, path) do nothing;
    end if;

    return v_image_id;
  end if;

  -- Stable normalized ordering prevents two concurrent imports with reversed
  -- tag arrays from waiting on the same unique-index locks in opposite order.
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
    values (v_owner_id, v_image_id, v_tag_id)
    on conflict do nothing;
  end loop;

  return v_image_id;
end;
$$;

revoke all on function public.create_ui_image_with_tags(
  uuid, uuid, uuid, uuid, text, text, text, text, text,
  integer, integer, bigint, integer, text, text, text[]
) from public, anon;
grant execute on function public.create_ui_image_with_tags(
  uuid, uuid, uuid, uuid, text, text, text, text, text,
  integer, integer, bigint, integer, text, text, text[]
) to authenticated;

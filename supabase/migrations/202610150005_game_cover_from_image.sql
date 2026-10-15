-- A cover owns a separate Storage object: deleting the source screenshot must
-- not delete the book cover. The browser copies the thumbnail first, then this
-- transaction switches the reference and durably queues obsolete cover files.
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
  v_game public.games%rowtype;
  v_image public.ui_images%rowtype;
  v_game_prefix text;
  v_cover_prefix text;
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Match delete_game's lock order. Concurrent replacements serialize here,
  -- so each transaction queues the cover it actually replaced, not a stale one.
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

  -- Replaying a successful request is harmless; never queue the active cover.
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

revoke all on function public.set_game_cover_from_image(uuid, uuid, text) from public, anon;
grant execute on function public.set_game_cover_from_image(uuid, uuid, text) to authenticated;

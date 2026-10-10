-- Durable cleanup requests are written in the same transaction as metadata
-- deletion. The authenticated browser removes objects with its own Storage RLS.
create table public.storage_cleanup_queue (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bucket text not null check (bucket in ('game-ui-originals', 'game-ui-thumbnails')),
  path text not null check (btrim(path) <> ''),
  created_at timestamptz not null default now(),
  constraint storage_cleanup_queue_owner_bucket_path_key unique (owner_id, bucket, path)
);

create index storage_cleanup_queue_owner_id_idx
  on public.storage_cleanup_queue (owner_id, id);

alter table public.storage_cleanup_queue enable row level security;

create policy "storage_cleanup_queue_select_own" on public.storage_cleanup_queue
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "storage_cleanup_queue_insert_own" on public.storage_cleanup_queue
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and path like ((select auth.uid())::text || '/%')
  );
create policy "storage_cleanup_queue_delete_own" on public.storage_cleanup_queue
  for delete to authenticated using (owner_id = (select auth.uid()));

revoke all on table public.storage_cleanup_queue from public, anon;
grant select, insert, delete on table public.storage_cleanup_queue to authenticated;
revoke all on sequence public.storage_cleanup_queue_id_seq from public, anon;
grant usage on sequence public.storage_cleanup_queue_id_seq to authenticated;

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
  v_image public.ui_images%rowtype;
  v_target public.modules%rowtype;
  v_flow_name text;
  v_flow_id uuid;
  v_game_name text;
  v_platform text;
  v_version text;
  v_tags text;
  v_sequence_order integer;
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_image
  from public.ui_images
  where id = p_image_id and owner_id = v_owner_id
  for update;
  if not found then
    raise exception 'Image not found' using errcode = 'P0002';
  end if;

  select * into v_target
  from public.modules
  where id = p_target_module_id and owner_id = v_owner_id
  for update;
  if not found or v_target.game_id <> v_image.game_id then
    raise exception 'Target module must belong to the same game' using errcode = '23514';
  end if;
  if v_image.module_id = p_target_module_id then
    return;
  end if;

  if v_image.flow_id is not null then
    select name into v_flow_name
    from public.flows
    where id = v_image.flow_id and owner_id = v_owner_id;

    if v_flow_name is not null then
      insert into public.flows (owner_id, module_id, name, sort_order)
      select v_owner_id, p_target_module_id, v_flow_name,
        coalesce(max(sort_order), -1) + 1
      from public.flows
      where owner_id = v_owner_id and module_id = p_target_module_id
      on conflict (owner_id, module_id, name) do nothing;

      select id into v_flow_id
      from public.flows
      where owner_id = v_owner_id
        and module_id = p_target_module_id
        and name = v_flow_name;
    end if;
  end if;

  select coalesce(max(sequence_order), 0) + 1 into v_sequence_order
  from public.ui_images
  where owner_id = v_owner_id
    and module_id = p_target_module_id
    and flow_id is not distinct from v_flow_id;

  select name into v_game_name
  from public.games
  where id = v_image.game_id and owner_id = v_owner_id;
  select platform, version into v_platform, v_version
  from public.capture_sets
  where id = v_image.capture_set_id and owner_id = v_owner_id;
  select pg_catalog.string_agg(t.name, ' ' order by t.name) into v_tags
  from public.image_tags it
  join public.tags t on t.id = it.tag_id and t.owner_id = it.owner_id
  where it.image_id = p_image_id and it.owner_id = v_owner_id;

  update public.ui_images
  set module_id = p_target_module_id,
      flow_id = v_flow_id,
      sequence_order = v_sequence_order,
      search_text = pg_catalog.concat_ws(' ',
        v_game_name, v_target.key, v_target.name, v_image.title,
        v_flow_name, v_platform, v_version, v_tags
      )
  where id = p_image_id and owner_id = v_owner_id;
end;
$$;

create or replace function public.delete_ui_images(p_image_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_image_id uuid;
  v_image public.ui_images%rowtype;
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_image_ids is null or pg_catalog.array_position(p_image_ids, null) is not null then
    raise exception 'Image IDs are required' using errcode = '22023';
  end if;

  for v_image_id in
    select distinct ids.id from pg_catalog.unnest(p_image_ids) as ids(id) order by ids.id
  loop
    select * into v_image
    from public.ui_images
    where id = v_image_id and owner_id = v_owner_id
    for update;
    if not found then
      raise exception 'Image not found' using errcode = 'P0002';
    end if;

    insert into public.storage_cleanup_queue (owner_id, bucket, path)
    values (v_owner_id, 'game-ui-originals', v_image.original_path)
    on conflict (owner_id, bucket, path) do nothing;
    if v_image.thumbnail_path is not null then
      insert into public.storage_cleanup_queue (owner_id, bucket, path)
      values (v_owner_id, 'game-ui-thumbnails', v_image.thumbnail_path)
      on conflict (owner_id, bucket, path) do nothing;
    end if;

    delete from public.ui_images
    where id = v_image_id and owner_id = v_owner_id;
  end loop;
end;
$$;

create or replace function public.delete_game(p_game_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_game public.games%rowtype;
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_game
  from public.games
  where id = p_game_id and owner_id = v_owner_id
  for update;
  if not found then
    raise exception 'Game not found' using errcode = 'P0002';
  end if;

  insert into public.storage_cleanup_queue (owner_id, bucket, path)
  select v_owner_id, 'game-ui-originals', original_path
  from public.ui_images
  where game_id = p_game_id and owner_id = v_owner_id
  on conflict (owner_id, bucket, path) do nothing;

  insert into public.storage_cleanup_queue (owner_id, bucket, path)
  select v_owner_id, 'game-ui-thumbnails', thumbnail_path
  from public.ui_images
  where game_id = p_game_id and owner_id = v_owner_id and thumbnail_path is not null
  on conflict (owner_id, bucket, path) do nothing;

  if v_game.cover_original_path is not null then
    insert into public.storage_cleanup_queue (owner_id, bucket, path)
    values (v_owner_id, 'game-ui-originals', v_game.cover_original_path)
    on conflict (owner_id, bucket, path) do nothing;
  end if;
  if v_game.cover_thumbnail_path is not null then
    insert into public.storage_cleanup_queue (owner_id, bucket, path)
    values (v_owner_id, 'game-ui-thumbnails', v_game.cover_thumbnail_path)
    on conflict (owner_id, bucket, path) do nothing;
  end if;

  delete from public.games
  where id = p_game_id and owner_id = v_owner_id;
end;
$$;

revoke all on function public.move_ui_image_to_module(uuid, uuid) from public, anon;
grant execute on function public.move_ui_image_to_module(uuid, uuid) to authenticated;
revoke all on function public.delete_ui_images(uuid[]) from public, anon;
grant execute on function public.delete_ui_images(uuid[]) to authenticated;
revoke all on function public.delete_game(uuid) from public, anon;
grant execute on function public.delete_game(uuid) to authenticated;

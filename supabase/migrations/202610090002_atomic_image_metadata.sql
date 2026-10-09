-- Atomic metadata writes for uploaded images and later tag edits.
-- This is a separate migration so projects that already applied the initial
-- schema receive the RPCs on their next `supabase db push`.

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
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
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
  ) returning id into v_image_id;

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
declare
  v_owner_id uuid := auth.uid();
  v_existing_module_id uuid;
  v_flow_id uuid;
  v_tag_name text;
  v_tag_id uuid;
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select module_id into v_existing_module_id
  from public.ui_images
  where id = p_image_id and owner_id = v_owner_id
  for update;

  if v_existing_module_id is null then
    raise exception 'Image not found' using errcode = 'P0002';
  end if;
  if v_existing_module_id <> p_module_id then
    raise exception 'Image module mismatch' using errcode = '23514';
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
  set
    title = btrim(p_title),
    flow_id = v_flow_id,
    sequence_order = coalesce(p_sequence_order, 0),
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

revoke all on function public.create_ui_image_with_tags(
  uuid, uuid, uuid, uuid, text, text, text, text, text,
  integer, integer, bigint, integer, text, text, text[]
) from public, anon;
grant execute on function public.create_ui_image_with_tags(
  uuid, uuid, uuid, uuid, text, text, text, text, text,
  integer, integer, bigint, integer, text, text, text[]
) to authenticated;

revoke all on function public.update_ui_image_metadata_with_tags(
  uuid, uuid, text, text, integer, text, text[]
) from public, anon;
grant execute on function public.update_ui_image_metadata_with_tags(
  uuid, uuid, text, text, integer, text, text[]
) to authenticated;

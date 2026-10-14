-- Storage removal can succeed even when the browser closes before its cleanup
-- queue row is acknowledged. Confirm absence inside Postgres so a later retry
-- can safely clear the durable task without trusting an empty Storage response.
create or replace function public.acknowledge_storage_cleanup(p_queue_ids bigint[])
returns bigint[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_acknowledged_ids bigint[];
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_queue_ids is null or pg_catalog.array_position(p_queue_ids, null) is not null then
    raise exception 'Cleanup queue IDs are required' using errcode = '22023';
  end if;

  with candidates as materialized (
    select q.id, q.bucket, q.path
    from public.storage_cleanup_queue q
    where q.owner_id = v_owner_id
      and q.id = any(p_queue_ids)
      and q.path like (v_owner_id::text || '/%')
    order by q.id
    for update
  ), deleted as (
    delete from public.storage_cleanup_queue q
    using candidates c
    where q.id = c.id
      and q.owner_id = v_owner_id
      and not exists (
        select 1
        from storage.objects o
        where o.bucket_id = c.bucket
          and o.name = c.path
      )
    returning q.id
  )
  select coalesce(
    pg_catalog.array_agg(deleted.id order by deleted.id),
    array[]::bigint[]
  )
  into v_acknowledged_ids
  from deleted;

  return v_acknowledged_ids;
end;
$$;

-- Queue rows may only be removed by the absence-checking function above.
-- The function owner retains the required privilege through SECURITY DEFINER.
revoke delete on table public.storage_cleanup_queue from authenticated;
revoke all on function public.acknowledge_storage_cleanup(bigint[]) from public, anon;
grant execute on function public.acknowledge_storage_cleanup(bigint[]) to authenticated;

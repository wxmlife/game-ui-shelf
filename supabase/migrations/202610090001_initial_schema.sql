-- Game UI Shelf: private, per-user metadata and storage.
-- The browser client is expected to use only an anon/publishable key plus an
-- authenticated session. Every data path below is protected by auth.uid().

create extension if not exists pg_trgm with schema extensions;

create table public.games (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slug text not null check (btrim(slug) <> ''),
  name text not null check (btrim(name) <> ''),
  aliases text[] not null default '{}'::text[],
  cover_original_path text,
  cover_thumbnail_path text,
  cover_tone text not null default '#1d221f',
  developer text,
  platforms text[] not null default '{}'::text[],
  tags text[] not null default '{}'::text[],
  description text,
  search_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint games_owner_slug_key unique (owner_id, slug),
  constraint games_id_owner_key unique (id, owner_id)
);

create table public.capture_sets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  game_id uuid not null,
  platform text not null default '',
  version text,
  region text,
  captured_at date,
  source_url text,
  note text,
  search_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint capture_sets_game_owner_fk
    foreign key (game_id, owner_id)
    references public.games (id, owner_id)
    on delete cascade,
  constraint capture_sets_id_owner_key unique (id, owner_id),
  constraint capture_sets_id_game_owner_key unique (id, game_id, owner_id)
);

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  game_id uuid not null,
  key text not null check (btrim(key) <> ''),
  name text not null check (btrim(name) <> ''),
  sort_order integer not null default 0,
  search_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint modules_game_owner_fk
    foreign key (game_id, owner_id)
    references public.games (id, owner_id)
    on delete cascade,
  constraint modules_owner_game_key_key unique (owner_id, game_id, key),
  constraint modules_id_owner_key unique (id, owner_id),
  constraint modules_id_game_owner_key unique (id, game_id, owner_id)
);

create table public.flows (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  module_id uuid not null,
  name text not null check (btrim(name) <> ''),
  sort_order integer not null default 0,
  search_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint flows_module_owner_fk
    foreign key (module_id, owner_id)
    references public.modules (id, owner_id)
    on delete cascade,
  constraint flows_owner_module_name_key unique (owner_id, module_id, name),
  constraint flows_id_owner_key unique (id, owner_id),
  constraint flows_id_module_owner_key unique (id, module_id, owner_id)
);

create table public.ui_images (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  game_id uuid not null,
  capture_set_id uuid,
  module_id uuid not null,
  flow_id uuid,
  title text not null check (btrim(title) <> ''),
  original_filename text not null check (btrim(original_filename) <> ''),
  original_path text not null check (btrim(original_path) <> ''),
  thumbnail_path text check (thumbnail_path is null or btrim(thumbnail_path) <> ''),
  mime_type text not null default 'application/octet-stream',
  width integer not null default 0 check (width >= 0),
  height integer not null default 0 check (height >= 0),
  file_size_bytes bigint not null default 0 check (file_size_bytes >= 0),
  sequence_order integer not null default 0,
  fingerprint text,
  search_text text not null default '',
  ocr_text text,
  dominant_colors text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ui_images_game_owner_fk
    foreign key (game_id, owner_id)
    references public.games (id, owner_id)
    on delete cascade,
  constraint ui_images_capture_set_game_owner_fk
    foreign key (capture_set_id, game_id, owner_id)
    references public.capture_sets (id, game_id, owner_id)
    on delete cascade,
  constraint ui_images_module_game_owner_fk
    foreign key (module_id, game_id, owner_id)
    references public.modules (id, game_id, owner_id)
    on delete cascade,
  constraint ui_images_flow_module_owner_fk
    foreign key (flow_id, module_id, owner_id)
    references public.flows (id, module_id, owner_id)
    on delete set null (flow_id),
  constraint ui_images_id_owner_key unique (id, owner_id)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tags_owner_name_key unique (owner_id, name),
  constraint tags_id_owner_key unique (id, owner_id)
);

create table public.image_tags (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  image_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, image_id, tag_id),
  constraint image_tags_image_owner_fk
    foreign key (image_id, owner_id)
    references public.ui_images (id, owner_id)
    on delete cascade,
  constraint image_tags_tag_owner_fk
    foreign key (tag_id, owner_id)
    references public.tags (id, owner_id)
    on delete cascade
);

-- Read ordering and owner-scoped relationship lookups.
create index capture_sets_owner_game_idx
  on public.capture_sets (owner_id, game_id, updated_at desc);
create index modules_owner_game_order_idx
  on public.modules (owner_id, game_id, sort_order, name);
create index flows_owner_module_order_idx
  on public.flows (owner_id, module_id, sort_order, name);
create index ui_images_owner_game_order_idx
  on public.ui_images (owner_id, game_id, module_id, flow_id, sequence_order, created_at);
create index ui_images_owner_capture_set_idx
  on public.ui_images (owner_id, capture_set_id);
create unique index ui_images_owner_fingerprint_key
  on public.ui_images (owner_id, fingerprint)
  where fingerprint is not null;
create index image_tags_owner_tag_idx
  on public.image_tags (owner_id, tag_id, image_id);
create unique index tags_owner_normalized_name_key
  on public.tags (owner_id, lower(btrim(name)));

-- Trigram indexes keep partial English and CJK searches responsive. search_text
-- is intentionally explicit so upload/import code can include denormalized
-- game, module, title, platform, version, and tag text in one searchable value.
create index games_search_text_trgm_idx
  on public.games using gin (search_text extensions.gin_trgm_ops);
create index capture_sets_search_text_trgm_idx
  on public.capture_sets using gin (search_text extensions.gin_trgm_ops);
create index modules_search_text_trgm_idx
  on public.modules using gin (search_text extensions.gin_trgm_ops);
create index flows_search_text_trgm_idx
  on public.flows using gin (search_text extensions.gin_trgm_ops);
create index ui_images_search_text_trgm_idx
  on public.ui_images using gin (search_text extensions.gin_trgm_ops);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger games_set_updated_at
before update on public.games
for each row execute function public.set_updated_at();
create trigger capture_sets_set_updated_at
before update on public.capture_sets
for each row execute function public.set_updated_at();
create trigger modules_set_updated_at
before update on public.modules
for each row execute function public.set_updated_at();
create trigger flows_set_updated_at
before update on public.flows
for each row execute function public.set_updated_at();
create trigger ui_images_set_updated_at
before update on public.ui_images
for each row execute function public.set_updated_at();
create trigger tags_set_updated_at
before update on public.tags
for each row execute function public.set_updated_at();
create trigger image_tags_set_updated_at
before update on public.image_tags
for each row execute function public.set_updated_at();

alter table public.games enable row level security;
alter table public.capture_sets enable row level security;
alter table public.modules enable row level security;
alter table public.flows enable row level security;
alter table public.ui_images enable row level security;
alter table public.tags enable row level security;
alter table public.image_tags enable row level security;

create policy "games_select_own" on public.games
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "games_insert_own" on public.games
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "games_update_own" on public.games
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "games_delete_own" on public.games
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "capture_sets_select_own" on public.capture_sets
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "capture_sets_insert_own" on public.capture_sets
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "capture_sets_update_own" on public.capture_sets
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "capture_sets_delete_own" on public.capture_sets
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "modules_select_own" on public.modules
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "modules_insert_own" on public.modules
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "modules_update_own" on public.modules
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "modules_delete_own" on public.modules
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "flows_select_own" on public.flows
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "flows_insert_own" on public.flows
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "flows_update_own" on public.flows
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "flows_delete_own" on public.flows
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "ui_images_select_own" on public.ui_images
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "ui_images_insert_own" on public.ui_images
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "ui_images_update_own" on public.ui_images
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "ui_images_delete_own" on public.ui_images
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "tags_select_own" on public.tags
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "tags_insert_own" on public.tags
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "tags_update_own" on public.tags
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "tags_delete_own" on public.tags
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "image_tags_select_own" on public.image_tags
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "image_tags_insert_own" on public.image_tags
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "image_tags_update_own" on public.image_tags
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "image_tags_delete_own" on public.image_tags
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Do not rely on RLS alone for anonymous access: remove table privileges from
-- anon/PUBLIC, then grant only the CRUD surface needed by authenticated users.
revoke all on table
  public.games,
  public.capture_sets,
  public.modules,
  public.flows,
  public.ui_images,
  public.tags,
  public.image_tags
from public, anon;

grant select, insert, update, delete on table
  public.games,
  public.capture_sets,
  public.modules,
  public.flows,
  public.ui_images,
  public.tags,
  public.image_tags
to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'game-ui-originals',
    'game-ui-originals',
    false,
    26214400,
    array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
  ),
  (
    'game-ui-thumbnails',
    'game-ui-thumbnails',
    false,
    2097152,
    array['image/webp', 'image/png']
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Object names must begin with "<auth.uid()>/". Signed URLs are therefore
-- available only after the caller passes the same SELECT policy.
create policy "game_ui_storage_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('game-ui-originals', 'game-ui-thumbnails')
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "game_ui_storage_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('game-ui-originals', 'game-ui-thumbnails')
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "game_ui_storage_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('game-ui-originals', 'game-ui-thumbnails')
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id in ('game-ui-originals', 'game-ui-thumbnails')
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "game_ui_storage_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('game-ui-originals', 'game-ui-thumbnails')
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

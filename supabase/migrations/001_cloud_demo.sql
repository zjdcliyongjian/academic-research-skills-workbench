create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  username text unique,
  role text not null default 'user' check (role in ('user','admin')),
  status text not null default 'active' check (status in ('active','disabled')),
  force_logout_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null,
  field text not null,
  goal text not null,
  language text not null default 'zh' check (language in ('zh','en','bilingual')),
  paper_type text not null default 'general' check (paper_type in ('general','technical','benchmark')),
  status text not null default 'active' check (status in ('active','paused','completed')),
  stage text not null default 'brief' check (stage in ('brief','idea','research','blueprint','writing','production','review','export')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_owner_updated_idx on public.projects(owner_id, updated_at desc);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('file','url')),
  blob_url text,
  sha256 text,
  size bigint,
  url text,
  status text not null default 'raw',
  mime_type text,
  snapshot_url text,
  title text,
  authors jsonb not null default '[]'::jsonb,
  publication_year integer,
  venue text,
  doi text,
  processing_status text not null default 'registered',
  failure_reason text,
  ocr_used boolean not null default false,
  ocr_pages integer not null default 0,
  extracted_text text,
  processed_at timestamptz,
  metadata_verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sources_project_created_idx on public.sources(project_id, created_at desc);

create table if not exists public.evidence_claims (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  source_id uuid references public.sources(id) on delete set null,
  claim_type text not null check (claim_type in ('source_fact','synthesis','inference','unknown')),
  claim_text text not null,
  locator text,
  quote_text text,
  quote_sha256 text,
  verification_status text not null default 'pending',
  note text,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  skill_name text not null,
  status text not null default 'queued',
  prompt text not null,
  input_json text not null default '{}',
  output text not null default '',
  error text,
  review_status text not null default 'pending',
  review_note text,
  parent_run_id uuid references public.runs(id) on delete set null,
  cancel_requested_at timestamptz,
  reviewed_at timestamptz,
  adopted_at timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists runs_project_started_idx on public.runs(project_id, started_at desc);

create table if not exists public.stage_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  stage text not null,
  version_number integer not null,
  run_id uuid not null references public.runs(id) on delete cascade,
  skill_name text not null,
  content text not null,
  content_sha256 text,
  status text not null default 'active',
  adopted_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique(project_id, stage, version_number)
);

create table if not exists public.model_configs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  model text not null,
  base_url text not null,
  encrypted_api_key text not null,
  key_hint text not null,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, provider, model)
);
create unique index if not exists model_configs_one_default_idx on public.model_configs(owner_id) where is_default;

create table if not exists public.exports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  format text not null,
  language text not null default 'unknown',
  blob_url text not null,
  preview_text text,
  size bigint not null default 0,
  release_status text not null default 'formal',
  created_at timestamptz not null default now()
);

create table if not exists public.product_feedback (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  category text not null check (category in ('bug','feature','question','other')),
  title text not null,
  details text not null,
  reproduction text,
  expected text,
  contact text,
  context jsonb not null default '{}'::jsonb,
  status text not null default 'submitted',
  created_at timestamptz not null default now()
);
create index if not exists product_feedback_owner_created_idx on public.product_feedback(owner_id, created_at desc);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users(id) on delete restrict,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text,
  resource_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on public.admin_audit_logs(created_at desc);

-- Keep repeatable migrations safe when an earlier draft of the schema already exists.
alter table public.sources add column if not exists snapshot_url text;
alter table public.runs add column if not exists input_json text not null default '{}';
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles add column if not exists status text not null default 'active';
alter table public.profiles add column if not exists force_logout_at timestamptz;
alter table public.profiles add column if not exists last_seen_at timestamptz;
create unique index if not exists profiles_username_unique_idx on public.profiles(username) where username is not null;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.sources enable row level security;
alter table public.evidence_claims enable row level security;
alter table public.runs enable row level security;
alter table public.stage_versions enable row level security;
alter table public.model_configs enable row level security;
alter table public.exports enable row level security;
alter table public.product_feedback enable row level security;
alter table public.admin_audit_logs enable row level security;

drop policy if exists owner_all on public.profiles;
drop policy if exists owner_all on public.projects;
drop policy if exists owner_all on public.sources;
drop policy if exists owner_all on public.evidence_claims;
drop policy if exists owner_all on public.runs;
drop policy if exists owner_all on public.stage_versions;
drop policy if exists owner_all on public.model_configs;
drop policy if exists owner_all on public.exports;
drop policy if exists owner_all on public.product_feedback;
drop policy if exists admin_service_only on public.admin_audit_logs;

create policy owner_all on public.profiles for all
using (id = auth.uid()) with check (id = auth.uid());
create policy owner_all on public.projects for all
using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- model_configs intentionally has no authenticated-client policy. The service API
-- authenticates the user, then reads/writes encrypted secrets with the service role.

create policy owner_all on public.sources for all
using (owner_id = auth.uid() and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
with check (owner_id = auth.uid() and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
create policy owner_all on public.evidence_claims for all
using (owner_id = auth.uid() and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
with check (owner_id = auth.uid() and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
create policy owner_all on public.runs for all
using (owner_id = auth.uid() and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
with check (owner_id = auth.uid() and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
create policy owner_all on public.stage_versions for all
using (owner_id = auth.uid() and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
with check (owner_id = auth.uid() and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
create policy owner_all on public.exports for all
using (owner_id = auth.uid() and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
with check (owner_id = auth.uid() and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
create policy owner_all on public.product_feedback for all
using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- admin_audit_logs intentionally has no client policy; it is service-role only.

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'research-files',
  'research-files',
  false,
  209715200,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/markdown', 'text/plain', 'text/html', 'text/csv', 'application/zip',
    'application/x-tex', 'application/x-bibtex', 'application/octet-stream'
  ]
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists research_files_select on storage.objects;
drop policy if exists research_files_insert on storage.objects;
drop policy if exists research_files_update on storage.objects;
drop policy if exists research_files_delete on storage.objects;
create policy research_files_select on storage.objects for select to authenticated
using (bucket_id = 'research-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy research_files_insert on storage.objects for insert to authenticated
with check (bucket_id = 'research-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy research_files_update on storage.objects for update to authenticated
using (bucket_id = 'research-files' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'research-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy research_files_delete on storage.objects for delete to authenticated
using (bucket_id = 'research-files' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, display_name, username, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, new.phone, 'researcher'), '@', 1)),
    coalesce(new.raw_user_meta_data->>'username', split_part(coalesce(new.email, 'researcher'), '@', 1)),
    case when new.raw_app_meta_data->>'role' = 'admin' then 'admin' else 'user' end,
    'active'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at before update on public.projects
for each row execute procedure public.touch_updated_at();
drop trigger if exists model_configs_touch_updated_at on public.model_configs;
create trigger model_configs_touch_updated_at before update on public.model_configs
for each row execute procedure public.touch_updated_at();
drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute procedure public.touch_updated_at();

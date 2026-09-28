-- Query patterns used by the cloud API: owner isolation plus project/status ordering.
-- These indexes keep the 100-user trial from scanning another user's rows.
create index if not exists sources_owner_project_created_idx
  on public.sources(owner_id, project_id, created_at desc);

create index if not exists evidence_owner_project_created_idx
  on public.evidence_claims(owner_id, project_id, created_at desc);

create index if not exists runs_owner_project_started_idx
  on public.runs(owner_id, project_id, started_at desc);

create index if not exists runs_owner_status_idx
  on public.runs(owner_id, status);

create index if not exists stage_versions_owner_project_adopted_idx
  on public.stage_versions(owner_id, project_id, adopted_at desc);

create index if not exists exports_owner_project_created_idx
  on public.exports(owner_id, project_id, created_at desc);

create index if not exists model_configs_owner_default_updated_idx
  on public.model_configs(owner_id, is_default, updated_at desc);

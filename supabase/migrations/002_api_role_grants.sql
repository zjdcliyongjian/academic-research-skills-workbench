-- API roles still need table privileges; RLS remains the row-level boundary.
grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on table
  public.profiles,
  public.projects,
  public.sources,
  public.evidence_claims,
  public.runs,
  public.stage_versions,
  public.exports,
  public.product_feedback
to authenticated;

-- Encrypted model credentials and audit logs remain server-only.
grant all privileges on table
  public.profiles,
  public.projects,
  public.sources,
  public.evidence_claims,
  public.runs,
  public.stage_versions,
  public.model_configs,
  public.exports,
  public.product_feedback,
  public.admin_audit_logs
to service_role;

grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges for role postgres in schema public
  grant all privileges on tables to service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;

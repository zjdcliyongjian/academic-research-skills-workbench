-- Explicit grants keep anonymous browser clients outside every research table.
-- RLS remains the per-user row boundary for authenticated access.
revoke all privileges on table
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
from anon;

-- Encrypted model credentials and audit history are only available through the
-- authenticated server API, which uses the service role after checking JWTs.
revoke all privileges on table
  public.model_configs,
  public.admin_audit_logs
from authenticated;

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

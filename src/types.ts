export type ProjectStage = "brief" | "idea" | "research" | "blueprint" | "writing" | "production" | "review" | "export";
export type ProjectStatus = "active" | "paused" | "completed";
export type LanguageMode = "zh" | "en" | "bilingual";
export type PaperType = "general" | "technical" | "benchmark";
export type RunStatus = "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled" | "declined";
export type ReviewStatus = "pending" | "adopted" | "rejected" | "revision_requested";

export interface SystemHealth {
  app: { status: string; version: string; port: number };
  codex: {
    status: "ready" | "unavailable" | "starting";
    cliVersion: string | null;
    authenticated: boolean;
    accountType: string | null;
    transport: string;
    error: string | null;
  };
  skills: {
    expected: number;
    ready: number;
    totalDiscovered: number;
    items: SkillInfo[];
    warning: string | null;
  };
  vault: { root: string; exists: boolean; writable: boolean };
  deepLink: { registered: boolean; template: string };
  database: { integrity: string; projects: number; sources: number; runs: number; pendingApprovals: number };
}

export interface SkillInfo {
  name: string;
  label: string;
  stage: ProjectStage;
  category: "foundation" | "production" | "review";
  deliveryStage: "阶段 1" | "阶段 2" | "阶段 3";
  description: string;
  input: string;
  output: string;
  gate: string;
  found: boolean;
  enabled: boolean;
  path: string | null;
}

export interface ResearchProject {
  id: string;
  name: string;
  slug: string;
  field: string;
  goal: string;
  language: LanguageMode;
  paperType: PaperType;
  status: ProjectStatus;
  stage: ProjectStage;
  vaultRoot: string;
  projectPath: string;
  threadId: string | null;
  createdAt: string;
  updatedAt: string;
  sourceCount: number;
  runCount: number;
  latestRunStatus: RunStatus | null;
}

export interface SourceRecord {
  id: string;
  projectId: string;
  name: string;
  kind: "file" | "url";
  relativePath: string | null;
  sha256: string | null;
  size: number | null;
  url: string | null;
  status: "raw" | "metadata-verified" | "content-verified" | "conflicted" | "rejected";
  mimeType: string | null;
  snapshotPath: string | null;
  extractedPath: string | null;
  title: string | null;
  authors: string[];
  publicationYear: number | null;
  venue: string | null;
  doi: string | null;
  processingStatus: "registered" | "processing" | "metadata_pending" | "metadata_verified" | "content_verified" | "duplicate_candidate" | "failed" | "rejected";
  failureReason: string | null;
  ocrUsed: boolean;
  ocrPages: number;
  processedAt: string | null;
  metadataVerifiedAt: string | null;
  createdAt: string;
}

export interface SourcePreview {
  source: SourceRecord;
  content: string;
  note: string;
}

export interface SourceUploadItem {
  id: string;
  file: File;
  name: string;
  size: number;
  status: "queued" | "uploading" | "succeeded" | "failed";
  error: string | null;
}

export interface EvidenceClaim {
  id: string;
  projectId: string;
  sourceId: string | null;
  claimType: "source_fact" | "synthesis" | "inference" | "unknown";
  claimText: string;
  locator: string | null;
  quoteText: string | null;
  quoteSha256: string | null;
  verificationStatus: "pending" | "verified" | "rejected" | "conflicted";
  note: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

export interface RunRecord {
  id: string;
  projectId: string;
  skillName: string;
  threadId: string;
  turnId: string | null;
  status: RunStatus;
  prompt: string;
  output: string;
  artifactPath: string | null;
  adoptedAt: string | null;
  parentRunId: string | null;
  cancelRequestedAt: string | null;
  reviewStatus: ReviewStatus;
  reviewedAt: string | null;
  reviewNote: string | null;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface StageVersion {
  id: string;
  projectId: string;
  stage: "brief" | "idea" | "research" | "blueprint" | "writing" | "production" | "review";
  versionNumber: number;
  runId: string;
  skillName: string;
  relativePath: string;
  contentSha256: string | null;
  status: "active" | "superseded" | "needs_review";
  adoptedAt: string;
  supersededAt: string | null;
}

export interface ApprovalRequest {
  id: string;
  runId: string;
  method: string;
  reason: string | null;
  command: string | null;
  cwd: string | null;
}

export interface ProjectDetail {
  project: ResearchProject;
  sources: SourceRecord[];
  evidenceClaims: EvidenceClaim[];
  runs: RunRecord[];
  approvals: ApprovalRequest[];
  versions: StageVersion[];
  passport?: MaterialPassport;
  schema9Import?: Schema9ImportReport | null;
  revisionWorkspace?: RevisionWorkspace;
  verification?: VerificationStatus;
  readiness: ProjectReadiness;
}

export interface VerificationStatus {
  pdfPreflights: Array<{
    sourceId: string;
    sourceName: string;
    verdict: "PASS" | "FAIL" | "UNAVAILABLE";
    reason: string | null;
    checkedAt: string;
    contentSha256: string | null;
    sidecarPath: string;
    report: Record<string, unknown>;
  }>;
  cache: {
    status: "ready" | "empty";
    path: string;
    rows: number;
    citations: number;
    oldest: string | null;
    newest: string | null;
    staleAdvisoryDays: number;
    ttlDays: number;
  };
  latestProgrammatic: null | {
    status: "completed" | "failed" | "invalid";
    diagnostic_only?: true;
    generated_at?: string;
    outcome_count?: number;
    stderr?: string;
    boundary?: string;
    errors?: string[];
  };
  authorizationText: string;
}

export interface Schema9ImportReport {
  contract: "ars-workbench-schema9-import-report/1.0";
  imported_at?: string;
  file_name?: string;
  imported_relative_path?: string;
  content_sha256?: string;
  status: "invalid" | "core_compatible" | "validated_subset";
  scope?: string;
  errors: string[];
  warnings: string[];
  unvalidated_extensions?: string[];
  checks?: Record<string, { status: "passed" | "failed" | "unavailable" | "not_applicable"; code: number | null; stdout: string; stderr: string }>;
}

export interface RevisionTarget {
  block_id: string;
  allowed_operations: Array<"replace_block" | "insert_after" | "delete_block">;
}

export interface RevisionWorkspace {
  roadmap: null | {
    schemaVersion: "revision-roadmap/1.0";
    revisionRound: number;
    baseDraftSha256: string;
    blockManifestSha256: string;
    totalItems: number;
    editorialDecision: string;
    importedAt: string | null;
    contentSha256: string;
    items: Array<{
      id: string;
      description: string;
      reviewer: string;
      obligationClass: "must_fix" | "should_fix" | "consider";
      targetSection: string;
      suggestedAction: string;
      verificationCriteria: string;
      proposedTargets: RevisionTarget[];
    }>;
  };
  decisions: Array<{
    itemId: string;
    authorTriage: "will_address" | "wont_address" | "not_on_point";
    authorReason: string | null;
    authorizedTargets: RevisionTarget[];
    authorEventId: string;
    recordedAt: string;
  }>;
  complete: boolean;
  exportReady: boolean;
  exportedRelativePath?: string | null;
  boundary: string;
}

export interface MaterialPassport {
  schema_version: "ars-workbench-material-passport/1.0";
  projection_scope: "WORKBENCH_PROJECTION";
  generated_at: string;
  projection_sha256: string;
  counts: {
    sources: number;
    content_verified_sources: number;
    claims: number;
    verified_claims: number;
    unresolved_claims: number;
    runs: number;
    active_versions: number;
    needs_review_versions: number;
    open_checkpoints: number;
    pending_tool_approvals: number;
  };
  literature_corpus_projection: Array<{
    source_id: string;
    name: string;
    status: string;
    locator: string | null;
    sha256: string | null;
    human_read_status: "not_recorded";
  }>;
  claim_registry_projection: Array<{
    claim_id: string;
    source_id: string | null;
    claim_type: EvidenceClaim["claimType"];
    claim_text: string;
    locator: string | null;
    verification_status: EvidenceClaim["verificationStatus"];
  }>;
  version_registry: Array<{
    version_id: string;
    stage: string;
    version_number: number;
    path: string;
    content_sha256: string | null;
    status: string;
  }>;
  author_checkpoints: Array<{
    id: string;
    run_id: string;
    stage: string;
    status: "open" | "closed";
    decision: string | null;
  }>;
  run_ledger: {
    status: string;
    ledger_path: string;
    entries: number;
    backed: number;
    awaiting_answer: Array<{ checkpoint_id: string; stage: string; checkpoint_type: string; question: string }>;
    cannot_confirm: unknown[];
    not_run: unknown[];
    missing: unknown[];
    counters: Record<string, Record<string, number>>;
    diagnostic?: string | null;
  };
  boundaries: string[];
}

export interface ReadinessStage {
  stage: ProjectStage;
  label: string;
  status: "ready" | "warning" | "blocked";
  blockers: string[];
  warnings: string[];
  activeVersionId: string | null;
}

export interface ProjectReadiness {
  status: "ready" | "warning" | "blocked";
  stage: ProjectStage;
  blockers: string[];
  warnings: string[];
  nextActions: { view: string; label: string }[];
  counts: {
    sources: number; verifiedSources: number; evidenceClaims: number; verifiedFacts: number;
    unresolvedEvidence: number; activeRuns: number; failedRuns: number; activeVersions: number; needsReviewVersions: number;
  };
  stages: ReadinessStage[];
}

export interface CreateProjectInput {
  name: string;
  field: string;
  goal: string;
  language: LanguageMode;
  paperType: PaperType;
}

export interface IdeaEvaluationInput {
  idea: string;
  weeklyHours: number;
  timelineMonths: number;
  skills: string;
  resources: string;
  targetVenue: string;
}

export interface ExportFile {
  name: string;
  relativePath: string;
  format: "markdown" | "docx" | "bibtex" | "latex" | "package";
  language: "zh" | "en" | "unknown";
  size: number;
  modifiedAt: string;
  previewKind: "markdown" | "docx-text" | "plain-text" | "package-manifest";
  releaseStatus: "formal" | "draft" | "legacy";
}

export interface ExportPreview {
  file: ExportFile;
  kind: "markdown" | "docx-text" | "plain-text" | "package-manifest";
  content: string;
  note: string | null;
}

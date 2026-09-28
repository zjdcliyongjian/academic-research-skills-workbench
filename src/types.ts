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
  readiness: ProjectReadiness;
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

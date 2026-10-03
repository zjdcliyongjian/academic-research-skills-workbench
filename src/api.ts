import type {
  ApprovalRequest,
  CreateProjectInput,
  IdeaEvaluationInput,
  ExportFile,
  ExportPreview,
  EvidenceClaim,
  ProjectDetail,
  ResearchProject,
  RunRecord,
  StageVersion,
  SourceRecord,
  SourcePreview,
  SystemHealth,
} from "./types";
import { accessToken, cloudMode, supabase } from "./cloud/supabase";

export type SessionInfo = { id: string; username: string; role: "user" | "admin"; status: "active" | "disabled" };
export type AdminUserRecord = { id: string; username: string; role: "user" | "admin"; status: "active" | "disabled"; createdAt: string; lastSignInAt: string | null; projectCount: number; sourceCount: number };
export type AdminFileRecord = { id: string; kind: "source" | "export"; name: string; projectId: string; projectName?: string; size: number; format: string; downloadable: boolean; externalUrl: string | null; createdAt: string };
export type AdminFeedbackRecord = { id: string; ownerId: string; username: string; category: "bug" | "feature" | "question" | "other"; title: string; details: string; reproduction: string | null; expected: string | null; contact: string | null; status: "submitted" | "reviewing" | "resolved" | "closed"; createdAt: string };
export type OcrConfig = { configured: boolean; provider: "paddleocr"; keyHint: string | null; enabled: boolean; updatedAt: string | null };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body instanceof ArrayBuffer ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `请求失败：${response.status}`);
  }
  return data as T;
}

async function download(url: string, suggestedName?: string) {
  const token = await accessToken();
  const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `下载失败：${response.status}`);
  }
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = suggestedName || "download";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export const api = {
  trialRegister: (input: { account: string; password: string }) =>
    request<{ ok: true }>("/api/auth/register", { method: "POST", body: JSON.stringify(input) }),
  localLogin: (input: { account: string; password: string }) =>
    request<{ ok: true; user: SessionInfo }>("/api/auth/login", { method: "POST", body: JSON.stringify(input) }),
  localLogout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST", body: "{}" }),
  session: () => request<{ user: SessionInfo }>("/api/session"),
  health: () => request<SystemHealth>("/api/health"),
  projects: () => request<{ projects: ResearchProject[] }>("/api/projects"),
  project: (id: string) => request<ProjectDetail>(`/api/projects/${id}`),
  syncPassport: (id: string) => request<{ passport: ProjectDetail["passport"] }>(`/api/projects/${id}/passport/sync`, { method: "POST", body: "{}" }),
  importSchema9Passport: (id: string, fileName: string, content: string) =>
    request<{ report: NonNullable<ProjectDetail["schema9Import"]> }>(`/api/projects/${id}/passport/schema9-import`, { method: "POST", body: JSON.stringify({ fileName, content }) }),
  downloadSchema9Passport: (id: string, name = "schema9-passport.json") => download(`/api/projects/${id}/passport/schema9-export`, name),
  importRevisionRoadmap: (id: string, content: string) =>
    request<{ workspace: NonNullable<ProjectDetail["revisionWorkspace"]> }>(`/api/projects/${id}/revision/roadmap`, { method: "POST", body: JSON.stringify({ content }) }),
  saveRevisionDecision: (id: string, itemId: string, input: { authorTriage: string; authorReason: string; authorWords: string; authorizedTargets: Array<{ blockId: string; allowedOperations: string[] }> }) =>
    request<{ workspace: NonNullable<ProjectDetail["revisionWorkspace"]> }>(`/api/projects/${id}/revision/decisions/${encodeURIComponent(itemId)}`, { method: "POST", body: JSON.stringify(input) }),
  finalizeRevisionInput: (id: string, authorWords: string) =>
    request<{ workspace: NonNullable<ProjectDetail["revisionWorkspace"]> }>(`/api/projects/${id}/revision/finalize`, { method: "POST", body: JSON.stringify({ authorWords }) }),
  downloadRevisionInput: (id: string) => download(`/api/projects/${id}/revision/export`, "author-adjudication-input.json"),
  runPdfPreflight: (id: string, sourceId: string) =>
    request<{ preflight: NonNullable<ProjectDetail["verification"]>["pdfPreflights"][number]; status: NonNullable<ProjectDetail["verification"]> }>(`/api/projects/${id}/verification/pdf/${encodeURIComponent(sourceId)}`, { method: "POST", body: "{}" }),
  runCitationVerification: (id: string, input: { authorized: boolean; authorizationText: string; revalidateStale: boolean }) =>
    request<{ report: NonNullable<NonNullable<ProjectDetail["verification"]>["latestProgrammatic"]>; status: NonNullable<ProjectDetail["verification"]> }>(`/api/projects/${id}/verification/citations`, { method: "POST", body: JSON.stringify(input) }),
  createProject: (input: CreateProjectInput) =>
    request<{ project: ResearchProject; codexWarning?: string }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateProject: (projectId: string, input: CreateProjectInput & { status: ResearchProject["status"] }) =>
    request<{ project: ResearchProject }>(`/api/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(input) }),
  createBackup: () => request<{ path: string; createdAt: string }>("/api/system/backup", { method: "POST", body: "{}" }),
  clearResearchData: () => request<{
    cleared: true;
    storageObjects?: number;
    recoveryPath?: string | null;
    backupsPreserved?: boolean;
    counts: {
      projects: number;
      sources: number;
      evidenceClaims: number;
      runs: number;
      versions: number;
      exports?: number;
      feedback?: number;
      approvals?: number;
      productFeedback?: number;
    };
  }>("/api/account/research-data", { method: "DELETE" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>("/api/account/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  uploadSource: async (projectId: string, file: File) => {
    if (file.size > 200 * 1024 * 1024) throw new Error("单个文件最多 200MB，请压缩或拆分后重试");
    if (cloudMode) {
      if (!supabase) throw new Error("在线服务配置不完整");
      const ticket = await request<{ sourceId: string; path: string; token: string }>(`/api/projects/${projectId}/sources/upload-ticket`, {
        method: "POST",
        body: JSON.stringify({ name: file.name, size: file.size, mimeType: file.type || "application/octet-stream" }),
      });
      const uploaded = await supabase.storage.from("research-files").uploadToSignedUrl(ticket.path, ticket.token, file, {
        contentType: file.type || "application/octet-stream",
      });
      if (uploaded.error) throw new Error(uploaded.error.message || "文件上传失败");
      return request<{ source: SourceRecord }>(`/api/projects/${projectId}/sources/upload-finalize`, {
        method: "POST",
        body: JSON.stringify({ sourceId: ticket.sourceId, path: ticket.path, name: file.name, size: file.size, mimeType: file.type || "application/octet-stream" }),
      });
    }
    const body = await file.arrayBuffer();
    return request<{ source: SourceRecord }>(
      `/api/projects/${projectId}/sources?name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type)}`,
      {
        method: "POST",
        body,
        headers: { "Content-Type": "application/octet-stream" },
      },
    );
  },
  addUrl: (projectId: string, url: string) =>
    request<{ source: SourceRecord }>(`/api/projects/${projectId}/sources/url`, {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  processSource: (projectId: string, sourceId: string) =>
    request<{ source: SourceRecord; duplicates: SourceRecord[]; queued?: boolean }>(`/api/projects/${projectId}/sources/${sourceId}/process`, { method: "POST", body: "{}" }),
  previewVersion: (projectId: string, versionId: string) =>
    request<{ content: string }>(`/api/projects/${projectId}/versions/${versionId}`),
  previewSource: (projectId: string, sourceId: string) =>
    request<SourcePreview>(`/api/projects/${projectId}/sources/${sourceId}/preview`),
  downloadSourceUrl: (projectId: string, sourceId: string, kind: "original" | "snapshot" | "extracted" = "original") =>
    `/api/projects/${projectId}/sources/${sourceId}/download?kind=${encodeURIComponent(kind)}`,
  verifySource: (projectId: string, sourceId: string, scope: "metadata" | "content" | "reject", note = "", metadata?: Partial<Pick<SourceRecord, "title" | "authors" | "publicationYear" | "venue" | "doi">>) =>
    request<{ source: SourceRecord }>(`/api/projects/${projectId}/sources/${sourceId}/verify`, { method: "POST", body: JSON.stringify({ scope, note, metadata }) }),
  deleteSource: (projectId: string, sourceId: string) =>
    request<{ deleted: boolean; trashPaths: string[] }>(`/api/projects/${projectId}/sources/${sourceId}`, { method: "DELETE" }),
  createEvidence: (projectId: string, input: { sourceId?: string; claimType: EvidenceClaim["claimType"]; claimText: string; locator?: string; quoteText?: string; note?: string }) =>
    request<{ claim: EvidenceClaim }>(`/api/projects/${projectId}/evidence`, { method: "POST", body: JSON.stringify(input) }),
  reviewEvidence: (claimId: string, status: EvidenceClaim["verificationStatus"], note = "") =>
    request<{ claim: EvidenceClaim }>(`/api/evidence/${claimId}/review`, { method: "POST", body: JSON.stringify({ status, note }) }),
  deleteEvidence: (claimId: string) =>
    request<{ deleted: boolean }>(`/api/evidence/${claimId}`, { method: "DELETE" }),
  startIdeaEvaluation: (projectId: string, input: IdeaEvaluationInput) =>
    request<{ run: RunRecord }>(`/api/projects/${projectId}/runs/idea-evaluator`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  startStageRun: (projectId: string, skillName: string, instructions: string) =>
    request<{ run: RunRecord }>(`/api/projects/${projectId}/runs/${skillName}`, {
      method: "POST",
      body: JSON.stringify({ instructions }),
    }),
  resolveApproval: (approval: ApprovalRequest, decision: "accept" | "decline" | "cancel") =>
    request<{ ok: true }>(`/api/approvals/${encodeURIComponent(approval.id)}`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),
  reviewRun: (runId: string, decision: "adopt" | "reject" | "request_revision", note = "") =>
    request<{ run: RunRecord; nextRun?: RunRecord; version?: StageVersion; project: ResearchProject }>(`/api/runs/${runId}/reviews`, {
      method: "POST",
      body: JSON.stringify({ decision, note }),
    }),
  retryRun: (runId: string) =>
    request<{ run: RunRecord }>(`/api/runs/${runId}/retry`, { method: "POST", body: "{}" }),
  cancelRun: (runId: string) =>
    request<{ run: RunRecord; alreadyFinished: boolean; relatedRunIds?: string[] }>(`/api/runs/${runId}/cancel`, { method: "POST", body: "{}" }),
  deleteRun: (runId: string) =>
    request<{ deleted: boolean; trashPath: string | null }>(`/api/runs/${runId}`, { method: "DELETE" }),
  openCodex: (projectId: string) =>
    request<{ opened: boolean; uri: string }>(`/api/projects/${projectId}/open-codex`, {
      method: "POST",
      body: "{}",
    }),
  exportProject: (projectId: string, format: "markdown" | "docx" | "bibtex" | "latex" | "package", language: "zh" | "en") =>
    request<{ path: string }>(`/api/projects/${projectId}/exports`, {
      method: "POST",
      body: JSON.stringify({ format, language }),
    }),
  exports: (projectId: string) =>
    request<{ files: ExportFile[] }>(`/api/projects/${projectId}/exports`),
  previewExport: (projectId: string, relativePath: string) =>
    request<ExportPreview>(`/api/projects/${projectId}/exports/preview?path=${encodeURIComponent(relativePath)}`),
  downloadExportUrl: (projectId: string, relativePath: string) =>
    `/api/projects/${projectId}/exports/download?path=${encodeURIComponent(relativePath)}`,
  deleteExport: (projectId: string, relativePath: string) =>
    request<{ deleted: boolean; trashPath: string | null }>(`/api/projects/${projectId}/exports?path=${encodeURIComponent(relativePath)}`, { method: "DELETE" }),
  downloadSource: (projectId: string, sourceId: string, kind: "original" | "snapshot" | "extracted" = "original", name?: string) =>
    download(`/api/projects/${projectId}/sources/${sourceId}/download?kind=${encodeURIComponent(kind)}`, name),
  downloadExport: (projectId: string, relativePath: string, name?: string) =>
    download(`/api/projects/${projectId}/exports/download?path=${encodeURIComponent(relativePath)}`, name),
  cloudProviders: () => request<{ items: { id: string; provider: string; model: string; baseUrl: string; keyHint: string; isDefault: boolean }[] }>("/api/cloud/providers"),
  saveCloudProvider: (input: { provider: string; model: string; baseUrl: string; apiKey: string }) =>
    request<{ ok: true; tested: true }>("/api/cloud/providers", { method: "PUT", body: JSON.stringify(input) }),
  discoverCloudProviderModels: (input: { provider: string; baseUrl: string; apiKey: string }) =>
    request<{ models: string[] }>("/api/cloud/providers/models", { method: "POST", body: JSON.stringify(input) }),
  activateCloudProvider: (id: string) =>
    request<{ ok: true; tested: true; activeId: string }>(`/api/cloud/providers/${encodeURIComponent(id)}/activate`, { method: "POST", body: "{}" }),
  deleteCloudProvider: (id: string) =>
    request<{ deleted: true }>(`/api/cloud/providers/${encodeURIComponent(id)}`, { method: "DELETE" }),
  cloudOcrConfig: () => request<OcrConfig>("/api/cloud/ocr"),
  saveCloudOcrConfig: (accessToken: string) =>
    request<{ ok: true; config: OcrConfig }>("/api/cloud/ocr", { method: "PUT", body: JSON.stringify({ accessToken }) }),
  deleteCloudOcrConfig: () => request<{ deleted: boolean }>("/api/cloud/ocr", { method: "DELETE" }),
  publicSettings: () => request<{ contactBloggerEnabled: boolean }>("/api/public/settings"),
  adminSetContactBloggerEnabled: (enabled: boolean) =>
    request<{ ok: true; contactBloggerEnabled: boolean }>("/api/admin/settings/contact-blogger", { method: "PUT", body: JSON.stringify({ enabled }) }),
  submitFeedback: (input: { projectId?: string | null; category: "bug" | "feature" | "question" | "other"; title: string; details: string; reproduction?: string; expected?: string; contact?: string; context: Record<string, unknown> }) =>
    request<{ item: { id: string; status: string; createdAt: string } }>("/api/feedback", { method: "POST", body: JSON.stringify(input) }),
  adminUsers: () => request<{ items: AdminUserRecord[] }>("/api/admin/users"),
  adminFiles: (ownerId: string) => request<{ projects: { id: string; name: string }[]; items: AdminFileRecord[] }>(`/api/admin/files?ownerId=${encodeURIComponent(ownerId)}`),
  adminSetUserStatus: (userId: string, status: "active" | "disabled") => request<{ ok: true }>(`/api/admin/users/${encodeURIComponent(userId)}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  adminSignOutUser: (userId: string) => request<{ ok: true }>(`/api/admin/users/${encodeURIComponent(userId)}/signout`, { method: "POST", body: "{}" }),
  adminResetUserPassword: (userId: string, password: string) => request<{ ok: true }>(`/api/admin/users/${encodeURIComponent(userId)}/password`, { method: "POST", body: JSON.stringify({ password }) }),
  adminDownloadFile: (file: AdminFileRecord) => download(`/api/admin/files/${file.kind}/${encodeURIComponent(file.id)}/download`, file.name),
  adminFeedback: () => request<{ items: AdminFeedbackRecord[] }>("/api/admin/feedback"),
  adminSetFeedbackStatus: (feedbackId: string, status: AdminFeedbackRecord["status"]) => request<{ ok: true }>(`/api/admin/feedback/${encodeURIComponent(feedbackId)}/status`, { method: "POST", body: JSON.stringify({ status }) }),
};

export function subscribeRun(
  runId: string,
  onEvent: (event: { type: string; run?: RunRecord; approval?: ApprovalRequest; delta?: string }) => void,
) {
  if (cloudMode) {
    let stopped = false;
    let latest = "";
    const tick = async () => {
      if (stopped) return;
      try {
        const { run } = await request<{ run: RunRecord }>(`/api/runs/${runId}`);
        const snapshot = JSON.stringify([run.status, run.output, run.error, run.reviewStatus]);
        if (snapshot !== latest) { latest = snapshot; onEvent({ type: "run", run }); }
        if (!["completed", "failed", "cancelled", "declined"].includes(run.status)) window.setTimeout(tick, 3000);
      } catch { onEvent({ type: "connection_error" }); if (!stopped) window.setTimeout(tick, 3000); }
    };
    void tick();
    return () => { stopped = true; };
  }
  const source = new EventSource(`/api/runs/${runId}/events`);
  source.onmessage = (event) => onEvent(JSON.parse(event.data));
  source.onerror = () => onEvent({ type: "connection_error" });
  return () => source.close();
}

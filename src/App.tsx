import { useEffect, useMemo, useState } from "react";
import {
  Archive, AlertTriangle, ArrowRight, ArrowUp, BookOpenText, BrainCircuit, Check, ChevronRight,
  Blocks, CircleDot, ClipboardCheck, Clock3, Database, DatabaseBackup, Download, Eye, ExternalLink, FileText,
  FolderKanban, FlaskConical, KeyRound, Link2, LoaderCircle, LogOut, Menu, MessageSquare, Moon, Plus,
  PackageCheck, RefreshCw, RotateCcw, Save, ScrollText, Settings, ShieldCheck, Sparkles, Sun, Trash2, Upload, UserCog, X,
} from "lucide-react";
import { api, subscribeRun, type AdminFeedbackRecord, type AdminFileRecord, type AdminUserRecord, type SessionInfo } from "./api";
import type { ApprovalRequest, CreateProjectInput, ExportFile, ExportPreview, IdeaEvaluationInput, ProjectDetail, ResearchProject, RunRecord, SourceUploadItem, StageVersion, SystemHealth } from "./types";
import { ResultDocument, ResultPreview } from "./ResultDocument";
import { TaskHint } from "./TaskHint";
import { downloadMarkdown, markdownFileName } from "./versionDownload";
import { SourceWorkspace } from "./SourceWorkspace";
import { cloudMode, supabase } from "./cloud/supabase";
import { ModelSettingsContent, OcrSettingsContent } from "./cloud/CloudGate";
import { ContactBlogger } from "./cloud/ContactBlogger";
import { PASSWORD_RULE_MESSAGE, passwordRuleError } from "./cloud/authValidation";
import { initialOnboardingStep, type OnboardingStep } from "./cloud/onboarding";
import { prepareSourceUploadBatch, retrySourceUploadItem, runSourceUploadBatch } from "./sourceUploadBatch";
import { buildRunConversations, conversationForRun } from "./runConversation";

type View = "overview" | "sources" | "workflow" | "idea" | "research" | "blueprint" | "writing" | "production" | "review" | "skills" | "export" | "feedback" | "contact" | "admin" | "model" | "system";

const stages = [
  { id: "brief", label: "课题卡", icon: ClipboardCheck },
  { id: "idea", label: "Idea 评估", icon: BrainCircuit },
  { id: "research", label: "文献调研", icon: BookOpenText },
  { id: "blueprint", label: "论文蓝图", icon: ScrollText },
  { id: "writing", label: "章节写作", icon: FileText },
  { id: "production", label: "图表整稿", icon: FlaskConical },
  { id: "review", label: "投稿审查", icon: ShieldCheck },
  { id: "export", label: "正式导出", icon: Archive },
] as const;

const nav = [
  { id: "overview", label: "项目台", icon: FolderKanban },
  { id: "sources", label: "资料与证据", icon: Database },
  { id: "workflow", label: "研究路线", icon: FolderKanban },
  { id: "idea", label: "Idea 评估", icon: BrainCircuit },
  { id: "research", label: "文献调研", icon: BookOpenText },
  { id: "blueprint", label: "论文蓝图", icon: ScrollText },
  { id: "writing", label: "章节写作", icon: FileText },
  { id: "production", label: "图表整稿", icon: FlaskConical },
  { id: "review", label: "投稿审查", icon: ShieldCheck },
  { id: "skills", label: "科研 Skills", icon: Blocks },
  { id: "export", label: "导出", icon: Download },
  { id: "feedback", label: "反馈与建议", icon: MessageSquare },
  { id: "contact", label: "联系博主", icon: MessageSquare },
  { id: "admin", label: "管理后台", icon: UserCog },
  { id: "model", label: "模型配置", icon: KeyRound },
  { id: "system", label: "系统设置", icon: Settings },
] as const;

const stageOrder = stages.map((item) => item.id);
const labels: Record<string, string> = {
  "idea-evaluator": "Idea 评估", "deep-research": "深度文献调研",
  "tech-paper-template": "技术论文蓝图", "benchmark-paper-template": "Benchmark 论文蓝图",
  "intro-drafter": "引言起草", "paper-writer": "论文写作", "paper-polish": "论文润色",
  "figure-designer": "科研图表设计", "drawio-reconstruction": "Draw.io 重建",
  "pre-submission-reviewer": "投稿前审查", "rebuttal-guidance": "审稿回应",
  "vibe-research-workflow": "研究工作流",
};

const skillGroups = [
  { id: "foundation", label: "判断与调研", caption: "先确定方向、证据和论文结构，再进入生产。" },
  { id: "production", label: "写作与图表", caption: "以已确认的蓝图、证据和实验结果为输入。" },
  { id: "review", label: "投稿与回应", caption: "发现问题、规划回应，最终决定仍由作者作出。" },
] as const;

function relativeDate(value: string) {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return new Date(value).toLocaleDateString("zh-CN");
}

function fileSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function fileLanguage(value: ExportFile["language"]) {
  return value === "zh" ? "中文" : value === "en" ? "English" : "未标注";
}

function statusText(status: RunRecord["status"]) {
  return ({ queued: "排队中", running: "运行中", waiting_approval: "待审批", completed: "已完成", failed: "失败", cancelled: "已取消", declined: "已拒绝" } as const)[status];
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <div className="empty"><CircleDot size={24}/><h3>{title}</h3><p>{body}</p>{action}</div>;
}

function AccountPasswordSettings({ onNotice }: { onNotice: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validation = passwordRuleError(form.newPassword);
    if (validation) { onNotice(validation); return; }
    if (form.newPassword !== form.confirm) { onNotice("两次输入的新密码不一致。"); return; }
    if (form.currentPassword === form.newPassword) { onNotice("新密码不能与当前密码相同。"); return; }
    setSaving(true); onNotice("");
    try {
      await api.changePassword(form.currentPassword, form.newPassword);
      onNotice("密码已修改，请使用新密码重新登录。");
      const signedOut = await supabase?.auth.signOut({ scope: "global" });
      if (signedOut?.error) await supabase?.auth.signOut({ scope: "local" });
      window.location.reload();
    } catch (cause) { onNotice(cause instanceof Error ? cause.message : "密码修改失败"); }
    finally { setSaving(false); }
  };
  if (!open) return <button className="button secondary system-password-button" onClick={() => setOpen(true)}><KeyRound/>修改密码</button>;
  return <form className="account-password-form" onSubmit={submit}>
    <div><strong>修改登录密码</strong><p>{PASSWORD_RULE_MESSAGE}修改成功后，当前登录会立即结束。</p></div>
    <label>当前密码<input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} required/></label>
    <label>新密码<input type="password" minLength={8} maxLength={12} autoComplete="new-password" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} placeholder="例如 Lab2026@" required/></label>
    <label>再次输入新密码<input type="password" minLength={8} maxLength={12} autoComplete="new-password" value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} required/></label>
    <div className="admin-password-actions"><button type="button" className="button ghost small" onClick={() => { setOpen(false); setForm({ currentPassword: "", newPassword: "", confirm: "" }); }}>取消</button><button className="button primary small" disabled={saving}>{saving ? <LoaderCircle className="spin"/> : <KeyRound/>}确认修改</button></div>
  </form>;
}

function ClearResearchDataDialog({
  cloud,
  busy,
  onClose,
  onConfirm,
}: {
  cloud: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const phrase = "清除全部科研数据";
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (confirmation !== phrase) { setError(`请输入“${phrase}”后再继续。`); return; }
    setError("");
    try { await onConfirm(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "清除数据失败"); }
  };
  return <div className="modal-backdrop data-clear-backdrop" onMouseDown={onClose}>
    <form className="create-panel data-clear-dialog" role="dialog" aria-modal="true" aria-labelledby="data-clear-title" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
      <div className="panel-head"><div><span className="eyebrow">DATA MANAGEMENT · IRREVERSIBLE SCOPE</span><h2 id="data-clear-title">清除科研数据</h2></div><button type="button" className="icon-button" onClick={onClose} disabled={busy}><X/></button></div>
      <div className="data-clear-warning"><AlertTriangle/><div><strong>这是高风险操作</strong><p>{cloud ? "在线版会永久删除当前账号的科研数据和云端文件，删除后无法从工作台恢复。" : "本地版会移除工作台数据库记录，并把课题目录先移入 Vault 的清理回收区，方便人工恢复。"}</p></div></div>
      <div className="data-clear-scope"><strong>将清除</strong><ul><li>课题、资料、证据卡与来源处理结果</li><li>运行记录、草稿、正式版本与导出文件</li><li>当前账号提交的反馈记录</li></ul></div>
      <div className="data-clear-preserve"><ShieldCheck/><div><strong>不会清除</strong><p>账号、登录密码、模型 API Key、PaddleOCR Key，以及本地 SQLite 历史备份。{!cloud && "已创建的 Codex Desktop 线程也不会自动删除。"}</p></div></div>
      <label>输入确认文字：<input autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={phrase} disabled={busy} autoComplete="off"/></label>
      {error && <p className="error-text">{error}</p>}
      <div className="panel-actions"><button type="button" className="button ghost" onClick={onClose} disabled={busy}>取消</button><button className="button danger" disabled={busy || confirmation !== phrase}>{busy ? <LoaderCircle className="spin"/> : <Trash2/>}{busy ? "正在清除" : "确认清除数据"}</button></div>
    </form>
  </div>;
}

function CreateProject({ onClose, onCreated }: { onClose: () => void; onCreated: (p: ResearchProject) => void }) {
  const [form, setForm] = useState<CreateProjectInput>({ name: "", field: "", goal: "", language: "zh", paperType: "general" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key: keyof CreateProjectInput, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await api.createProject(form); onCreated(result.project); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <form className="create-panel" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
      <div className="panel-head"><div><span className="eyebrow">NEW RESEARCH PROJECT</span><h2>创建科研课题</h2></div><button type="button" className="icon-button" onClick={onClose}><X/></button></div>
      <p className="panel-intro">{cloudMode ? "先建立课题边界。工作台会为当前账号创建独立课题空间，并使用你配置的模型 API 执行科研 Skills。" : "先建立课题边界。工作台会创建独立 Vault 目录，并为本课题绑定一个可在 本地执行服务 中继续的任务。"}</p>
      <label>课题名称<input autoFocus value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="例如：小样本工业异常检测方法研究" required /></label>
      <div className="form-grid"><label>学科或领域<input value={form.field} onChange={(e) => update("field", e.target.value)} placeholder="计算机视觉 / 管理科学" required /></label><label>论文类型<select value={form.paperType} onChange={(e) => update("paperType", e.target.value)}><option value="general">通用研究</option><option value="technical">技术论文</option><option value="benchmark">Benchmark 论文</option></select></label></div>
      <label>研究目标<textarea value={form.goal} onChange={(e) => update("goal", e.target.value)} placeholder="说清楚希望解决的问题、对象和预期成果" required rows={5}/></label>
      <label>输出语言<select value={form.language} onChange={(e) => update("language", e.target.value)}><option value="zh">中文</option><option value="en">English</option><option value="bilingual">中英文双语</option></select></label>
      {error && <p className="error-text">{error}</p>}
      <div className="panel-actions"><button type="button" className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin"/> : <Sparkles/>}{busy ? "正在建立项目" : cloudMode ? "创建云端课题" : "创建课题"}</button></div>
    </form>
  </div>;
}

function ProjectSettings({ project, busy, onSave, onClose }: { project: ResearchProject; busy: boolean; onSave: (input: CreateProjectInput & { status: ResearchProject["status"] }) => void; onClose: () => void }) {
  const [form, setForm] = useState<CreateProjectInput & { status: ResearchProject["status"] }>({
    name: project.name, field: project.field, goal: project.goal, language: project.language, paperType: project.paperType, status: project.status,
  });
  useEffect(() => setForm({ name: project.name, field: project.field, goal: project.goal, language: project.language, paperType: project.paperType, status: project.status }), [project.id, project.updatedAt]);
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <form className="create-panel project-settings-panel" onSubmit={(event) => { event.preventDefault(); onSave(form); }} onMouseDown={(event) => event.stopPropagation()}>
      <div className="panel-head"><div><span className="eyebrow">PROJECT GOVERNANCE</span><h2>编辑当前课题</h2></div><button type="button" className="icon-button" onClick={onClose}><X/></button></div>
      <p className="panel-intro">调整课题边界、输出要求和项目状态。已有资料、证据目录和运行记录保持不变。</p>
      <label>课题名称<input value={form.name} onChange={(event) => update("name", event.target.value)} required/></label>
      <div className="form-grid"><label>学科或领域<input value={form.field} onChange={(event) => update("field", event.target.value)} required/></label><label>项目状态<select value={form.status} onChange={(event) => update("status", event.target.value)}><option value="active">进行中</option><option value="paused">已暂停</option><option value="completed">已完成</option></select></label></div>
      <div className="form-grid"><label>论文类型<select value={form.paperType} onChange={(event) => update("paperType", event.target.value)}><option value="general">通用研究</option><option value="technical">技术论文</option><option value="benchmark">Benchmark 论文</option></select></label><label>输出语言<select value={form.language} onChange={(event) => update("language", event.target.value)}><option value="zh">中文</option><option value="en">English</option><option value="bilingual">中英文双语</option></select></label></div>
      <label>研究目标<textarea rows={7} value={form.goal} onChange={(event) => update("goal", event.target.value)} required/></label>
      <div className="settings-path"><span>证据目录保持不变</span><code>{project.projectPath}</code></div>
      <div className="panel-actions"><button type="button" className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin"/> : <Save/>}保存课题信息</button></div>
    </form>
  </div>;
}

function OnboardingGuide({ step, onSkip, onSignOut }: { step: Exclude<OnboardingStep, null>; onSkip: () => void; onSignOut: () => void }) {
  return <div className="onboarding-backdrop" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
    <section className="onboarding-panel model-step">
      <header className="onboarding-header">
        <div><span className="eyebrow">MODEL SETUP</span><h1 id="onboarding-title">{step === "checking" ? "正在准备你的工作台" : "连接你的科研模型"}</h1><p>{step === "checking" ? "正在读取当前账号的模型配置，请稍候。" : "模型用于执行文献调研、Idea 评估和论文写作。你可以现在完成连接，也可以暂时跳过，稍后从模型配置继续。"}</p></div>
        {step !== "checking" && <div className="onboarding-header-actions"><button className="button ghost" onClick={onSkip}>暂时跳过</button><button className="button ghost onboarding-signout" onClick={onSignOut}><LogOut/>退出登录</button></div>}
      </header>
      {step === "checking" && <div className="onboarding-checking"><LoaderCircle className="spin"/><span>正在核验账号配置…</span></div>}
      {step === "model" && <><div className="onboarding-skip-note"><ShieldCheck/><span>暂时跳过不会保存任何模型信息；需要运行科研能力时，再前往“模型配置”完成配置。</span></div><div className="onboarding-model-shell"><ModelSettingsContent/></div></>}
    </section>
  </div>;
}

function FeedbackPage({ project, sourceView, version }: { project: ResearchProject | null; sourceView: View; version: string }) {
  const [form, setForm] = useState({ category: "bug" as "bug" | "feature" | "question" | "other", title: "", details: "", reproduction: "", expected: "", contact: "" });
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ id: string; createdAt: string } | null>(null);
  const [error, setError] = useState("");
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setReceipt(null);
    try {
      const result = await api.submitFeedback({
        ...form, projectId: project?.id || null,
        context: { sourceView, projectName: project?.name || null, mode: cloudMode ? "cloud" : "local", version, url: window.location.href, userAgent: navigator.userAgent },
      });
      setReceipt({ id: result.item.id, createdAt: result.item.createdAt });
      setForm((current) => ({ ...current, title: "", details: "", reproduction: "", expected: "" }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "反馈提交失败"); }
    finally { setBusy(false); }
  };
  return <section className="workspace-section feedback-page">
    <div className="page-heading"><div><span className="eyebrow">PRODUCT FEEDBACK</span><h1>反馈与建议</h1><p>遇到 Bug、使用障碍或希望补充的能力，都可以在这里提交；系统会自动附带当前页面与运行环境。</p></div></div>
    <div className="feedback-layout"><form className="input-card feedback-form" onSubmit={submit}>
      <div className="form-grid"><label>反馈类型<select value={form.category} onChange={(event) => update("category", event.target.value)}><option value="bug">Bug / 故障</option><option value="feature">功能建议</option><option value="question">使用问题</option><option value="other">其他</option></select></label><label>联系方式（可选）<input value={form.contact} onChange={(event) => update("contact", event.target.value)} placeholder="邮箱、微信或其他联系方式"/></label></div>
      <label>标题<input value={form.title} onChange={(event) => update("title", event.target.value)} maxLength={120} placeholder="用一句话说明问题或建议" required/></label>
      <label>详细说明<textarea rows={6} value={form.details} onChange={(event) => update("details", event.target.value)} maxLength={5000} placeholder="发生了什么、影响了什么，或你希望新增什么能力" required/></label>
      <label>复现步骤（Bug 时建议填写）<textarea rows={4} value={form.reproduction} onChange={(event) => update("reproduction", event.target.value)} placeholder="1. 进入哪个页面  2. 点击什么  3. 出现什么结果"/></label>
      <label>期望结果<textarea rows={3} value={form.expected} onChange={(event) => update("expected", event.target.value)} placeholder="你原本希望看到什么结果"/></label>
      {error && <p className="error-text">{error}</p>}{receipt && <div className="feedback-receipt"><Check/><div><strong>反馈已提交</strong><span>编号 {receipt.id} · {new Date(receipt.createdAt).toLocaleString("zh-CN")}</span></div></div>}
      <button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin"/> : <MessageSquare/>}{busy ? "正在提交" : "提交反馈"}</button>
    </form><aside className="feedback-context"><span className="eyebrow">AUTO CONTEXT</span><h2>系统会自动附带</h2><ul><li>来源页面：{nav.find((item) => item.id === sourceView)?.label || "工作台"}</li><li>当前课题：{project?.name || "尚未选择课题"}</li><li>运行方式：{cloudMode ? "在线版" : "本地版"}</li><li>工作台版本：{version || "读取中"}</li></ul><p>不会自动上传你的论文正文、API Key、密码或其他凭据。</p></aside></div>
  </section>;
}

function AdminConsole() {
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [feedback, setFeedback] = useState<AdminFeedbackRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [files, setFiles] = useState<AdminFileRecord[]>([]);
  const [passwordReset, setPasswordReset] = useState({ open: false, password: "", confirm: "" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const selected = users.find((item) => item.id === selectedId) || null;
  const loadUsers = async () => {
    setBusy("users"); setError("");
    try {
      const [result, feedbackResult] = await Promise.all([api.adminUsers(), api.adminFeedback()]); setUsers(result.items); setFeedback(feedbackResult.items);
      if (!selectedId) setSelectedId(result.items.find((item) => item.role !== "admin")?.id || result.items[0]?.id || null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "用户列表加载失败"); }
    finally { setBusy(""); }
  };
  const loadFiles = async (ownerId: string) => {
    setBusy("files"); setError("");
    try { const result = await api.adminFiles(ownerId); setFiles(result.items); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "文件列表加载失败"); }
    finally { setBusy(""); }
  };
  useEffect(() => { void loadUsers(); }, []);
  useEffect(() => { if (selectedId) void loadFiles(selectedId); else setFiles([]); }, [selectedId]);
  useEffect(() => { setPasswordReset({ open: false, password: "", confirm: "" }); setSuccess(""); }, [selectedId]);
  const userAction = async (action: "signout" | "active" | "disabled") => {
    if (!selected || selected.role === "admin") return;
    const label = action === "signout" ? "强制下线" : action === "disabled" ? "禁用" : "恢复";
    if (!window.confirm(`确定要${label}用户“${selected.username}”吗？`)) return;
    setBusy(action); setError("");
    try {
      if (action === "signout") await api.adminSignOutUser(selected.id); else await api.adminSetUserStatus(selected.id, action);
      await loadUsers();
    } catch (cause) { setError(cause instanceof Error ? cause.message : `${label}失败`); }
    finally { setBusy(""); }
  };
  const updateFeedbackStatus = async (item: AdminFeedbackRecord, status: AdminFeedbackRecord["status"]) => {
    setBusy(`feedback-${item.id}`); setError("");
    try { await api.adminSetFeedbackStatus(item.id, status); setFeedback((current) => current.map((entry) => entry.id === item.id ? { ...entry, status } : entry)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "反馈状态更新失败"); }
    finally { setBusy(""); }
  };
  const resetUserPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || selected.role === "admin") return;
    const validationError = passwordRuleError(passwordReset.password);
    if (validationError) { setError(validationError); return; }
    if (passwordReset.password !== passwordReset.confirm) { setError("两次输入的临时密码不一致。"); return; }
    setBusy("password"); setError(""); setSuccess("");
    try {
      await api.adminResetUserPassword(selected.id, passwordReset.password);
      setPasswordReset({ open: false, password: "", confirm: "" });
      setSuccess(`已为“${selected.username}”重置临时密码，原登录状态已失效。请通过安全渠道告知用户。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "密码重置失败"); }
    finally { setBusy(""); }
  };
  return <section className="workspace-section admin-page">
    <div className="page-heading"><div><span className="eyebrow">ADMIN CONTROL CENTER</span><h1>用户与文件管理</h1><p>仅管理员可查看。跨用户文件访问、强制下线和账号状态变更都会写入审计日志。</p></div><button className="button secondary" onClick={loadUsers} disabled={busy === "users"}><RefreshCw className={busy === "users" ? "spin" : ""}/>刷新</button></div>
    {error && <p className="error-text admin-error">{error}</p>}
    {success && <p className="admin-success">{success}</p>}
    <div className="admin-layout"><section className="admin-users"><div className="admin-section-head"><div><span className="eyebrow">USERS</span><h2>账号列表</h2></div><span>{users.length} 个账号</span></div>
      <div className="admin-user-list">{users.map((item) => <button key={item.id} className={item.id === selectedId ? "active" : ""} onClick={() => setSelectedId(item.id)}><div><strong>{item.username}</strong><span>{item.role === "admin" ? "管理员" : "普通用户"} · {item.projectCount} 个课题 · {item.sourceCount} 份资料</span></div><i className={item.status}>{item.status === "active" ? "正常" : "已禁用"}</i></button>)}</div>
    </section><section className="admin-detail">{selected ? <>
      <div className="admin-profile"><div><span className="eyebrow">SELECTED USER</span><h2>{selected.username}</h2><p>最近登录：{selected.lastSignInAt ? new Date(selected.lastSignInAt).toLocaleString("zh-CN") : "尚未登录"}</p></div>{selected.role !== "admin" && <div className="admin-user-actions"><button className="button secondary small" onClick={() => { setPasswordReset((current) => ({ ...current, open: !current.open })); setError(""); setSuccess(""); }} disabled={Boolean(busy)}><KeyRound/>重置密码</button><button className="button secondary small" onClick={() => userAction("signout")} disabled={Boolean(busy)}><LogOut/>强制下线</button>{selected.status === "active" ? <button className="button danger small" onClick={() => userAction("disabled")} disabled={Boolean(busy)}>禁用账号</button> : <button className="button primary small" onClick={() => userAction("active")} disabled={Boolean(busy)}>恢复账号</button>}</div>}</div>
      {selected.role !== "admin" && passwordReset.open && <form className="admin-password-reset" onSubmit={resetUserPassword}><div><strong>设置临时密码</strong><p>核验用户身份后设置。{PASSWORD_RULE_MESSAGE}重置成功会结束该用户已有登录状态。</p></div><label>临时密码<input type="password" minLength={8} maxLength={12} autoComplete="new-password" value={passwordReset.password} onChange={(event) => setPasswordReset({ ...passwordReset, password: event.target.value })} placeholder="例如 Lab2026@" required/></label><label>再次输入<input type="password" minLength={8} maxLength={12} autoComplete="new-password" value={passwordReset.confirm} onChange={(event) => setPasswordReset({ ...passwordReset, confirm: event.target.value })} required/></label><div className="admin-password-actions"><button type="button" className="button ghost small" onClick={() => setPasswordReset({ open: false, password: "", confirm: "" })}>取消</button><button className="button primary small" disabled={busy === "password"}>{busy === "password" ? <LoaderCircle className="spin"/> : <KeyRound/>}确认重置</button></div></form>}
      <div className="admin-files-head"><div><span className="eyebrow">USER FILES</span><h3>课题资料与导出文件</h3></div><span>{files.length} 个文件记录</span></div>
      <div className="admin-file-list">{busy === "files" ? <div className="history-empty"><LoaderCircle className="spin"/> 正在读取文件…</div> : files.length ? files.map((file) => <article key={`${file.kind}-${file.id}`}><div><strong>{file.name}</strong><span>{file.projectName || "未归属课题"} · {file.kind === "source" ? "原始资料" : "导出成果"} · {fileSize(file.size)}</span></div><div>{file.externalUrl && <a className="button ghost small" href={file.externalUrl} target="_blank" rel="noreferrer"><ExternalLink/>打开来源</a>}{file.downloadable && <button className="button secondary small" onClick={() => api.adminDownloadFile(file).catch((cause) => setError(cause.message))}><Download/>下载</button>}</div></article>) : <div className="history-empty">该用户还没有可查看的文件记录</div>}</div>
    </> : <Empty title="尚无用户" body="创建普通用户后，可在这里查看账号、课题和文件。"/>}</section></div>
    <section className="admin-feedback"><div className="admin-section-head"><div><span className="eyebrow">FEEDBACK INBOX</span><h2>用户反馈</h2></div><span>{feedback.filter((item) => !["resolved", "closed"].includes(item.status)).length} 条待处理</span></div><div className="admin-feedback-list">{feedback.length ? feedback.map((item) => <article key={item.id}><div className="admin-feedback-main"><div><span className={`feedback-category ${item.category}`}>{({ bug: "Bug", feature: "功能建议", question: "使用问题", other: "其他" } as const)[item.category]}</span><time>{item.username} · {new Date(item.createdAt).toLocaleString("zh-CN")}</time></div><strong>{item.title}</strong><p>{item.details}</p>{item.reproduction && <small>复现步骤：{item.reproduction}</small>}{item.expected && <small>期望结果：{item.expected}</small>}</div><select value={item.status} disabled={busy === `feedback-${item.id}`} onChange={(event) => updateFeedbackStatus(item, event.target.value as AdminFeedbackRecord["status"])}><option value="submitted">待处理</option><option value="reviewing">处理中</option><option value="resolved">已解决</option><option value="closed">已关闭</option></select></article>) : <div className="history-empty">暂时没有用户反馈</div>}</div></section>
  </section>;
}

function ReadinessPanel({ detail, onGo }: { detail: ProjectDetail; onGo: (view: View) => void }) {
  const readiness = detail.readiness;
  const issues = [...readiness.blockers.map((text) => ({ text, blocker: true })), ...readiness.warnings.slice(0, 4).map((text) => ({ text, blocker: false }))];
  return <section className={`readiness-panel ${readiness.status}`}>
    <div className="readiness-summary"><div className="readiness-icon">{readiness.status === "ready" ? <Check/> : <AlertTriangle/>}</div><div><span className="eyebrow">TRIAL READINESS</span><h2>{readiness.status === "ready" ? "当前阶段可以继续" : readiness.status === "blocked" ? "当前阶段存在阻断项" : "可以试运行，但需要留意证据缺口"}</h2><p>已核验来源 {readiness.counts.verifiedSources} · 已核验事实 {readiness.counts.verifiedFacts} · 当前正式版本 {readiness.counts.activeVersions}</p></div></div>
    {issues.length ? <ul>{issues.map((item) => <li className={item.blocker ? "blocker" : "warning"} key={`${item.blocker}-${item.text}`}>{item.text}</li>)}</ul> : <p className="readiness-clear">未发现当前阶段的硬性缺口。</p>}
    <div className="readiness-actions">{readiness.nextActions.slice(0, 2).map((action) => <button className="button secondary small" key={`${action.view}-${action.label}`} onClick={() => onGo(action.view as View)}>{action.label}<ArrowRight/></button>)}</div>
  </section>;
}

function StageSpine({ project }: { project: ResearchProject }) {
  const current = stageOrder.indexOf(project.stage);
  return <div className="stage-spine" aria-label="研究阶段">
    {stages.map((stage, index) => {
      const StateIcon = index < current ? Check : stage.icon;
      return <div className={`stage-node ${index < current ? "done" : index === current ? "active" : ""}`} key={stage.id}>
        <div className="stage-mark"><StateIcon size={17}/></div><span className="stage-index">0{index + 1}</span><strong>{stage.label}</strong>{index < stages.length - 1 && <div className="stage-line"/>}
      </div>;
    })}
  </div>;
}

type ReviewDecision = "adopt" | "request_revision";

export function StageHistory({ stage, runs, versions, activeRunId, busy = "", onSelect, onAdopt, onDelete }: { stage: StageVersion["stage"]; runs: RunRecord[]; versions: StageVersion[]; activeRunId: string | null; busy?: string; onSelect: (runId: string) => void; onAdopt: (run: RunRecord) => void; onDelete: (run: RunRecord) => void }) {
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [loadingVersion, setLoadingVersion] = useState<string | null>(null);
  const exportDraft = (run: RunRecord) => {
    setPreviewError("");
    try { downloadMarkdown(run.output || "", markdownFileName(labels[run.skillName] || run.skillName, "草稿", run.id)); }
    catch (error) { setPreviewError((error as Error).message); }
  };
  const exportVersion = async (version: StageVersion) => {
    setLoadingVersion(version.id); setPreviewError("");
    try { const result = await api.previewVersion(version.projectId, version.id); downloadMarkdown(result.content, markdownFileName(labels[version.skillName] || version.stage, `正式版本-V${String(version.versionNumber).padStart(3, "0")}`, version.id)); }
    catch (error) { setPreviewError((error as Error).message); }
    finally { setLoadingVersion(null); }
  };
  const stageVersions = versions.filter((version) => version.stage === stage);
  return <section className="stage-history">
    <div className="stage-history-head"><div><span className="eyebrow">VERSIONS & REVIEWS</span><h2>草稿与正式版本</h2></div><p>{runs.length} 个草稿 · {stageVersions.length} 个正式版本</p></div>
    {previewError && <p role="alert" className="error-text">{previewError}</p>}
    {preview && <ResultPreview {...preview} onClose={() => setPreview(null)}/>}
    <div className="history-grid">
      <div className="history-column"><h3>运行草稿</h3>{runs.length ? runs.map((run) => {
        const running = ["queued", "running", "waiting_approval"].includes(run.status);
        const deleteLabel = running ? "取消并删除运行记录" : "删除运行记录";
        return <div className="history-item" key={run.id}><button className={`history-row ${activeRunId === run.id ? "active" : ""}`} onClick={() => onSelect(run.id)}><div><strong>{labels[run.skillName] || run.skillName}</strong><span>{relativeDate(run.startedAt)} · {statusText(run.status)}</span></div><span className={`review-state ${run.reviewStatus}`}>{({ pending: "待审阅", adopted: "已采用", rejected: "已驳回", revision_requested: "修改中" } as const)[run.reviewStatus] || "待审阅"}</span></button><button className="button secondary small" disabled={!run.output} onClick={() => setPreview({ title: `${labels[run.skillName] || run.skillName} · 草稿`, content: run.output || "" })}><Eye/>预览</button><button type="button" className="button secondary small" disabled={!run.output?.trim()} title="导出此草稿为 Markdown 文件" onClick={() => exportDraft(run)}><Download/>导出</button>{run.status === "completed" && run.reviewStatus !== "adopted" && <button type="button" className="button primary small history-adopt" disabled={busy === `review-adopt-${run.id}`} onClick={() => onAdopt(run)}>{busy === `review-adopt-${run.id}` ? <LoaderCircle className="spin"/> : <Check/>}采用此版本</button>}{run.reviewStatus !== "adopted" && <button className={`history-delete ${running ? "cancel-delete" : ""}`} onClick={() => onDelete(run)} title={deleteLabel} aria-label={`${deleteLabel}：${labels[run.skillName] || run.skillName}`}><Trash2/></button>}</div>;
      }) : <p className="history-empty">还没有草稿</p>}</div>
      <div className="history-column"><h3>正式版本</h3>{stageVersions.length ? stageVersions.map((version) => <div className="history-row version-row" key={version.id}><div><strong>{stage.toUpperCase()} V{String(version.versionNumber).padStart(3, "0")}</strong><span>{relativeDate(version.adoptedAt)} · {labels[version.skillName] || version.skillName}</span><code>{version.relativePath}</code></div><div className="version-actions"><span className={`version-state ${version.status}`}>{version.status === "active" ? "当前版本" : version.status === "needs_review" ? "需复核" : "已替代"}</span><button className="button secondary small" disabled={loadingVersion !== null} title="导出此正式版本为 Markdown 文件" onClick={() => exportVersion(version)}><Download/>{loadingVersion === version.id ? "正在导出" : "导出"}</button></div></div>) : <p className="history-empty">尚无正式版本</p>}</div>
    </div>
  </section>;
}

type RunConsoleProps = { run: RunRecord | null; approvals: ApprovalRequest[]; busy: string; onRetry: () => void; onCancel: () => void; onResolve: (a: ApprovalRequest, d: "accept" | "decline") => void };

export function RunConsole({ run, approvals, busy, onRetry, onCancel, onResolve }: RunConsoleProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => setPreviewOpen(false), [run?.id]);
  if (!run) return <div className="run-console run-console-codex run-console-empty" role="status"><div className="run-empty-mark"><CircleDot size={24}/></div><div className="run-empty-copy"><span className="eyebrow">RESEARCH LIVE RUN</span><h3>还没有运行记录</h3><p>从当前阶段发起一次 Skill 运行，结果会实时显示在这里。</p></div></div>;
  const pending = approvals.filter((a) => a.runId === run.id);
  const running = ["queued", "running", "waiting_approval"].includes(run.status);
  const liveMessage = run.status === "queued" ? "任务已进入队列，正在等待执行…" : run.status === "waiting_approval" ? "等待确认后继续执行…" : run.status === "completed" ? "运行已完成，输出已同步。" : run.status === "failed" ? run.error || "执行失败，请查看错误信息并重试。" : run.status === "cancelled" ? "运行已取消，后台任务已停止。" : run.status === "declined" ? "审批未通过，本次运行未继续。" : "正在读取课题资料并执行任务…";
  const activityLabel = run.status === "completed" ? "已完成并保存草稿" : run.status === "failed" ? "运行失败" : run.status === "cancelled" ? "运行已取消" : run.status === "declined" ? "审批未通过" : run.status === "waiting_approval" ? "等待你的确认" : run.status === "queued" ? "任务已排队" : "正在运行研究任务";
  const runEvents = [
    { id: "created", state: "done", label: "已创建研究任务", detail: `${labels[run.skillName] || run.skillName} · ${relativeDate(run.startedAt)}` },
    { id: "status", state: ["queued", "running", "waiting_approval"].includes(run.status) ? "active" : run.status === "failed" ? "error" : "done", label: activityLabel, detail: liveMessage },
    { id: "output", state: run.output ? "done" : "muted", label: run.output ? "输出已同步" : "等待输出", detail: run.artifactPath ? run.artifactPath : "结果会自动保存为可追溯草稿" },
  ] as const;
  return <><div className="run-console run-console-codex">
    <div className="console-head run-console-head"><div className="run-console-title"><span className="eyebrow">RESEARCH LIVE RUN</span><h3>{labels[run.skillName] || run.skillName}</h3></div><div className="run-console-top-actions"><span className={`status-chip run-status-chip ${run.status}`} aria-label={`运行状态：${statusText(run.status)}`}>{["queued", "running", "waiting_approval"].includes(run.status) && <LoaderCircle className="spin" size={14}/>} {statusText(run.status)}</span></div></div>
    <div className="run-event-rail" aria-label="运行事件">{runEvents.map((event, index) => <div className={`run-event ${event.state}`} key={event.id}><span className="run-event-mark" aria-hidden="true">{event.state === "active" ? <LoaderCircle className="spin" size={13}/> : event.state === "error" ? <X size={13}/> : event.state === "done" ? <Check size={13}/> : <CircleDot size={11}/>}</span>{index < runEvents.length - 1 && <span className="run-event-line" aria-hidden="true"/>}<div className="run-event-copy"><strong>{event.label}</strong><span title={event.detail}>{event.detail}</span></div></div>)}</div>
    {pending.map((approval) => <div className="approval-card run-approval-card" key={approval.id}><ShieldCheck/><div><strong>需要你的确认</strong><p>{approval.reason || "系统请求执行受控操作"}</p>{approval.command && <code>{approval.command}</code>}</div><div className="approval-actions"><button onClick={() => onResolve(approval, "decline")}>拒绝</button><button className="approve" onClick={() => onResolve(approval, "accept")}>允许一次</button></div></div>)}
    <div className="output result-output run-output-surface" aria-live="polite">{run.output ? <button type="button" className="run-output-preview" onClick={() => setPreviewOpen(true)} aria-label={`预览${labels[run.skillName] || run.skillName}完整结果`}><span className="run-output-preview-icon"><Eye size={17}/></span><span><strong>预览研究结果</strong><small>点击查看完整内容</small></span></button> : <div className="run-output-placeholder">{running ? <LoaderCircle className="run-output-spinner spin" size={18}/> : <CircleDot size={18}/>}<span>{liveMessage}</span></div>}</div>
    <div className="console-footer run-console-footer"><div className="console-draft-meta run-draft-meta"><span title={run.artifactPath || undefined}>{run.artifactPath ? `草稿已留存：${run.artifactPath}` : "输出会自动保存为可追溯草稿"}</span></div>
      <div className="run-actions run-console-actions">{running && <button className="button secondary small run-stop-button" disabled={busy === "cancel"} onClick={onCancel}>取消运行</button>}{["failed", "cancelled", "declined"].includes(run.status) && <button className="button secondary small" disabled={busy === "retry"} onClick={onRetry}><RotateCcw/>重新运行</button>}{run.reviewStatus === "adopted" && <span className="adopted"><Check/>已采用</span>}</div>
    </div>
  </div>{previewOpen && <ResultPreview title={`${labels[run.skillName] || run.skillName} · 执行结果`} content={run.output || "正在生成内容…"} onClose={() => setPreviewOpen(false)}/>}</>;
}

function SavedRunMessage({ run }: { run: RunRecord }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  return <><div className="codex-saved-run"><div><span className={`status-chip ${run.status}`}>{statusText(run.status)}</span><strong>{run.output ? "本轮结果已保存" : run.error || "本轮没有完整输出"}</strong><small>{relativeDate(run.completedAt || run.startedAt)}</small></div>{run.output && <button type="button" className="button secondary small" onClick={() => setPreviewOpen(true)}><Eye/>预览本轮结果</button>}</div>{previewOpen && <ResultPreview title={`${labels[run.skillName] || run.skillName} · 历史回复`} content={run.output || ""} onClose={() => setPreviewOpen(false)}/>}</>;
}

type CodexRunWorkspaceProps = RunConsoleProps & {
  title: string;
  eyebrow: string;
  description: string;
  runs: RunRecord[];
  activeRunId: string | null;
  onSelectRun: (runId: string) => void;
  promptValue: string;
  /** Kept for route compatibility; the composer intentionally has no visible placeholder. */
  promptPlaceholder?: string;
  onPromptChange: (value: string) => void;
  onSubmit: (message: string) => Promise<void> | void;
  onReview: (decision: ReviewDecision, note: string) => Promise<boolean>;
  submitLabel: string;
  submitIcon?: React.ReactNode;
  sidebar?: React.ReactNode;
  disabled?: boolean;
};

function CodexRunWorkspace({
  title, eyebrow, description, runs, activeRunId, onSelectRun, promptValue,
  onPromptChange, onSubmit, submitLabel, submitIcon, sidebar, disabled, run, approvals, busy,
  onReview, onRetry, onCancel, onResolve,
}: CodexRunWorkspaceProps) {
  const [newTask, setNewTask] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState(false);
  const [pendingMessage, setPendingMessage] = useState("");
  const conversations = useMemo(() => buildRunConversations(runs), [runs]);
  const beginNewTask = () => { setNewTask(true); setPendingMessage(""); onPromptChange(""); };
  const selectRun = (runId: string) => { setNewTask(false); setPendingMessage(""); onSelectRun(runId); };
  const visibleRun = newTask ? null : run;
  const conversationRuns = useMemo(() => conversationForRun(runs, visibleRun?.id || null), [runs, visibleRun?.id]);
  const submitMessage = async () => {
    const message = promptValue.trim();
    if (disabled || !message) return;
    setNewTask(false);
    setPendingMessage(message);
    onPromptChange("");
    setPendingSubmission(true);
    try {
      if (visibleRun?.status === "completed" && visibleRun.reviewStatus !== "adopted") {
        await onReview("request_revision", message);
      } else {
        await onSubmit(message);
      }
    } finally {
      setPendingSubmission(false);
      setPendingMessage("");
    }
  };
  return <section className="codex-run-workspace" aria-label={`${title}运行工作区`}>
    <aside className="codex-run-rail">
      <div className="codex-run-rail-head"><div><span className="codex-rail-eyebrow">RESEARCH TASKS</span><h2>任务对话</h2></div><button type="button" className="codex-rail-icon" onClick={beginNewTask} aria-label="新建任务"><Plus size={16}/></button></div>
      <button type="button" className="codex-run-new" onClick={beginNewTask}><Plus size={15}/>新建任务</button>
      {sidebar && <div className="codex-run-settings">{sidebar}</div>}
      <div className="codex-run-history"><span className="codex-run-history-label">已保存对话</span>{conversations.length ? conversations.map((conversation) => { const active = conversation.turns.some((item) => item.id === activeRunId); const titleText = (conversation.root.prompt || labels[conversation.root.skillName] || conversation.root.skillName).replace(/\s+/g, " "); return <button type="button" className={`codex-run-history-item ${active ? "active" : ""}`} key={conversation.id} onClick={() => selectRun(conversation.latest.id)}><span className="codex-run-history-mark"><MessageSquare size={13}/></span><span><strong title={titleText}>{titleText}</strong><small>{conversation.turns.length} 轮 · {statusText(conversation.latest.status)} · {relativeDate(conversation.latest.startedAt)}</small></span></button>; }) : <p className="codex-run-history-empty">还没有对话记录<br/>从下方输入任务开始。</p>}</div>
      <div className="codex-run-rail-foot"><span className="codex-rail-dot"/>每轮对话都会保留在当前课题</div>
    </aside>
    <section className="codex-run-thread">
      <header className="codex-thread-head"><div><span className="codex-rail-eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div><span className={`codex-thread-state ${visibleRun ? visibleRun.status : "idle"}`}>{visibleRun ? statusText(visibleRun.status) : "等待输入"}</span></header>
      <div className="codex-thread-body">
        <div className="codex-message-stack">
          {conversationRuns.map((turn, index) => <div className="codex-turn-pair" key={turn.id}><article className="codex-message codex-message-user"><span className="codex-message-label">你的第 {index + 1} 轮</span><p>{turn.prompt || "历史任务"}</p></article><article className="codex-message codex-message-assistant"><div className="codex-message-label"><span className="codex-avatar"><FlaskConical size={13}/></span>科研工作台</div>{index === conversationRuns.length - 1 ? <RunConsole run={turn} approvals={approvals} busy={busy} onRetry={onRetry} onCancel={onCancel} onResolve={onResolve}/> : <SavedRunMessage run={turn}/>}</article></div>)}
          {pendingSubmission && <div className="codex-turn-pair"><article className="codex-message codex-message-user"><span className="codex-message-label">你的新消息</span><p>{pendingMessage}</p></article><article className="codex-message codex-message-assistant"><div className="codex-message-label"><span className="codex-avatar"><FlaskConical size={13}/></span>科研工作台</div><div className="run-console run-console-codex run-console-empty" role="status"><div className="run-empty-mark"><LoaderCircle className="spin" size={24}/></div><div className="run-empty-copy"><span className="eyebrow">RESEARCH LIVE RUN</span><h3>正在准备本轮回复</h3><p>已保存你的消息，正在启动并连接实时输出。</p></div></div></article></div>}
          {!conversationRuns.length && !pendingSubmission && <article className="codex-message codex-message-assistant"><div className="codex-message-label"><span className="codex-avatar"><FlaskConical size={13}/></span>科研工作台</div><RunConsole run={null} approvals={approvals} busy={busy} onRetry={onRetry} onCancel={onCancel} onResolve={onResolve}/></article>}
        </div>
      </div>
      <form className="codex-composer" onSubmit={(event) => { event.preventDefault(); void submitMessage(); }}>
        <textarea value={promptValue} onChange={(event) => onPromptChange(event.target.value)} rows={3} placeholder="" aria-label={`${title}任务输入`} />
        <div className="codex-composer-foot"><span aria-hidden="true" /><button type="submit" className="codex-composer-submit" disabled={disabled || pendingSubmission || !promptValue.trim()} aria-label={submitLabel}>{submitIcon || <ArrowUp size={17}/>}</button></div>
      </form>
    </section>
  </section>;
}

function SkillsCatalog({ health, onGo }: { health: SystemHealth | null; onGo: (view: View) => void }) {
  const items = health?.skills.items || [];
  const ready = items.filter((skill) => skill.found && skill.enabled).length;
  const routeFor = (skillName: string, stage: string): View => skillName === "vibe-research-workflow" ? "workflow" : stage === "idea" ? "idea" : skillName === "deep-research" ? "research" : stage === "blueprint" ? "blueprint" : ["intro-drafter", "paper-writer"].includes(skillName) ? "writing" : ["paper-polish", "figure-designer", "drawio-reconstruction"].includes(skillName) ? "production" : "review";
  return <section className="workspace-section skill-catalog">
    <div className="page-heading skill-heading"><div><span className="eyebrow">RESEARCH CAPABILITY INDEX</span><h1>科研 Skills</h1><p>12 个科研能力按研究生命周期组织。这里说明每个 Skill 具体做什么、需要什么输入、交付什么结果，以及必须由人确认的边界。</p></div><div className="skill-readiness"><strong>{ready}<span>/ {health?.skills.expected || 12}</span></strong><small>本机已就绪</small></div></div>
    <div className="skill-principle"><ShieldCheck/><div><strong>Skill 是专业工作方法，不是自动替你作决定。</strong><span>每次运行只加载当前需要的 Skill；来源、实验结果、语义修改和投稿动作仍保留人工确认。</span></div></div>
    {health ? skillGroups.map((group) => {
      const groupItems = items.filter((skill) => skill.category === group.id);
      return <section className="skill-group" key={group.id}>
        <div className="skill-group-head"><div><span>{groupItems.length} SKILLS</span><h2>{group.label}</h2></div><p>{group.caption}</p></div>
        <div className="skill-grid">{groupItems.map((skill, index) => <article className="skill-card" key={skill.name}>
          <div className="skill-card-head"><span className="skill-index">{String(index + 1).padStart(2, "0")}</span><div><span className="skill-code">{skill.name}</span><h3>{skill.label}</h3></div><span className={`skill-state ${skill.found && skill.enabled ? "ready" : "missing"}`}>{skill.found && skill.enabled ? "已安装" : "不可用"}</span></div>
          <p className="skill-description">{skill.description}</p>
          <dl className="skill-contract"><div><dt>需要什么</dt><dd>{skill.input}</dd></div><div><dt>交付什么</dt><dd>{skill.output}</dd></div></dl>
          <div className="skill-gate"><ShieldCheck/><span>{skill.gate}</span></div>
          <div className="skill-card-footer"><div><span>{skill.deliveryStage}</span><small>{skill.found && skill.enabled ? "工作台主链路已接通" : "本机 Skill 不可用"}</small></div>{skill.found && skill.enabled && <button className="text-link compact-link" onClick={() => onGo(routeFor(skill.name, skill.stage))}>进入环节 <ArrowRight/></button>}</div>
          {skill.path && <details className="skill-path"><summary>查看安装位置</summary><code>{skill.path}</code></details>}
        </article>)}</div>
      </section>;
    }) : <div className="skill-loading"><LoaderCircle className="spin"/><span>正在读取本机 Skill 状态…</span></div>}
  </section>;
}

export default function App() {
  const [theme, setTheme] = useState(localStorage.getItem("research-theme") || "light");
  const [view, setView] = useState<View>("overview");
  const [feedbackOrigin, setFeedbackOrigin] = useState<View>("overview");
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(null);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [clearDataOpen, setClearDataOpen] = useState(false);
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [url, setUrl] = useState("");
  const [instructionsByView, setInstructionsByView] = useState<Partial<Record<View, string>>>({});
  const [lifecycleSkills, setLifecycleSkills] = useState({ writing: "intro-drafter", production: "paper-polish", review: "pre-submission-reviewer" });
  const [exportFiles, setExportFiles] = useState<ExportFile[]>([]);
  const [exportPreview, setExportPreview] = useState<ExportPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState("");
  const [sourceUploads, setSourceUploads] = useState<SourceUploadItem[]>([]);
  const [focusedRunId, setFocusedRunId] = useState<string | null>(null);
  const [idea, setIdea] = useState<IdeaEvaluationInput>({ idea: "", weeklyHours: 8, timelineMonths: 6, skills: "", resources: "", targetVenue: "" });
  const instructions = instructionsByView[view] || "";
  const setInstructions = (value: string) => setInstructionsByView((current) => ({ ...current, [view]: value }));
  const selected = detail?.project.id === selectedId ? detail.project : projects.find((p) => p.id === selectedId) || null;
  const isAdmin = sessionInfo?.role === "admin";
  const canViewSkillsCatalog = !cloudMode || isAdmin;
  const relevantRuns = detail?.runs.filter((run) => {
    if (view === "idea") return run.skillName === "idea-evaluator";
    if (view === "workflow") return run.skillName === "vibe-research-workflow";
    if (view === "research") return run.skillName === "deep-research";
    if (view === "blueprint") return ["tech-paper-template", "benchmark-paper-template"].includes(run.skillName);
    if (view === "writing") return ["intro-drafter", "paper-writer"].includes(run.skillName);
    if (view === "production") return ["paper-polish", "figure-designer", "drawio-reconstruction"].includes(run.skillName);
    if (view === "review") return ["pre-submission-reviewer", "rebuttal-guidance"].includes(run.skillName);
    return false;
  }) || [];
  const activeRun = relevantRuns.find((run) => run.id === focusedRunId) || relevantRuns[0] || null;
  const projectHasActiveRun = detail?.runs.some((run) => ["queued", "running", "waiting_approval"].includes(run.status)) || false;

  const loadProjects = async () => {
    const result = await api.projects(); setProjects(result.projects);
    setSelectedId((current) => current || result.projects[0]?.id || null);
  };
  const loadDetail = async (id = selectedId) => { if (id) setDetail(await api.project(id)); };
  const loadExports = async (id = selectedId) => {
    if (!id) return [];
    const result = await api.exports(id);
    setExportFiles(result.files);
    return result.files;
  };
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("research-theme", theme); }, [theme]);
  useEffect(() => { if (cloudMode) api.session().then((result) => setSessionInfo(result.user)).catch(() => setSessionInfo(null)); }, []);
  useEffect(() => {
    if (!cloudMode || !sessionInfo) return;
    let cancelled = false;
    const skipKey = `research-model-onboarding-skipped:${sessionInfo.id}`;
    const hasActiveModel = (items: Array<{ isDefault: boolean }>) => items.some((item) => item.isDefault);
    const checkInitialState = async () => {
      const skipped = localStorage.getItem(skipKey) === "1";
      if (skipped) { setOnboardingStep(null); return; }
      setOnboardingStep("checking");
      try {
        const result = await api.cloudProviders();
        if (!cancelled) setOnboardingStep(initialOnboardingStep(hasActiveModel(result.items), skipped));
      } catch (error) {
        if (!cancelled) {
          setOnboardingStep("model");
          setNotice(error instanceof Error ? error.message : "模型配置状态读取失败");
        }
      }
    };
    const checkAfterModelChange = async () => {
      try {
        const result = await api.cloudProviders();
        if (!cancelled) setOnboardingStep(initialOnboardingStep(hasActiveModel(result.items), localStorage.getItem(skipKey) === "1"));
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : "首次使用状态更新失败");
      }
    };
    const onModelChanged = () => { void checkAfterModelChange(); };
    void checkInitialState();
    window.addEventListener("model-config-changed", onModelChanged);
    return () => { cancelled = true; window.removeEventListener("model-config-changed", onModelChanged); };
  }, [sessionInfo?.id]);
  useEffect(() => {
    if (cloudMode && sessionInfo && !isAdmin && view === "skills") {
      setView("overview");
      setNotice("科研 Skills 目录仅管理员可查看。");
    }
  }, [isAdmin, sessionInfo, view]);
  useEffect(() => { loadProjects().catch((e) => setNotice(e.message)); api.health().then(setHealth).catch((e) => setNotice(e.message)); }, []);
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    if (selectedId) api.project(selectedId).then((result) => { if (!cancelled) setDetail(result); }).catch((e) => { if (!cancelled) setNotice(e.message); });
    return () => { cancelled = true; };
  }, [selectedId]);
  useEffect(() => {
    setExportPreview(null);
    setFocusedRunId(null);
    if (view === "export" && selectedId) loadExports(selectedId).catch((e) => setNotice(e.message));
  }, [view, selectedId]);
  useEffect(() => {
    if (!activeRun || !["queued", "running", "waiting_approval"].includes(activeRun.status)) return;
    return subscribeRun(activeRun.id, (event) => {
      if (event.run) setDetail((current) => current ? { ...current, runs: [event.run!, ...current.runs.filter((r) => r.id !== event.run!.id)] } : current);
      if (event.approval) setDetail((current) => current ? { ...current, approvals: [event.approval!, ...current.approvals.filter((a) => a.id !== event.approval!.id)] } : current);
      if (["completed", "failed", "cancelled"].includes(event.type)) loadDetail();
    });
  }, [activeRun?.id, activeRun?.status]);
  const projectStats = useMemo(() => {
    const reviews = detail?.runs.filter((run) => run.status === "completed" && run.reviewStatus === "pending").length || 0;
    return { sources: detail?.sources.length || 0, runs: detail?.runs.length || 0, approvals: (detail?.approvals.length || 0) + reviews, reviews };
  }, [detail]);
  const created = async (project: ResearchProject) => { setCreateOpen(false); await loadProjects(); setSelectedId(project.id); setView("overview"); setNotice("课题已建立，并已创建独立证据目录。 "); };
  const runAction = async (skill: string, payload: IdeaEvaluationInput | string) => {
    if (!selected) return; setBusy(skill); setNotice("");
    if (selected.status !== "active") { setBusy(""); setNotice(selected.status === "completed" ? "课题已完成；如需继续运行，请在项目台点击“编辑课题”并恢复为进行中。" : "课题已暂停；请在项目台点击“编辑课题”并恢复为进行中。"); return; }
    if (projectHasActiveRun) { setBusy(""); setNotice("当前课题已有任务正在运行、排队或等待审批，请先完成或取消该任务。"); return; }
    try {
      const result = skill === "idea-evaluator" ? await api.startIdeaEvaluation(selected.id, payload as IdeaEvaluationInput) : await api.startStageRun(selected.id, skill, payload as string);
      setDetail((current) => current ? { ...current, runs: [result.run, ...current.runs] } : current);
      setFocusedRunId(result.run.id);
      setNotice(`${labels[skill] || skill} 已开始执行。`);
    } catch (e) { setNotice((e as Error).message); } finally { setBusy(""); }
  };
  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || !selected || busy === "upload") return;
    const projectId = selected.id;
    const batch = prepareSourceUploadBatch(files);
    if (!batch.files.length) { setNotice("没有可上传的新文件。"); return; }
    setBusy("upload");
    try {
      const result = await runSourceUploadBatch(batch, (file) => api.uploadSource(projectId, file), setSourceUploads, 3);
      await loadDetail(projectId);
      const succeeded = result.filter((item) => item.status === "succeeded").length;
      const failed = result.filter((item) => item.status === "failed").length;
      const duplicateNote = batch.skippedDuplicates ? `，已跳过 ${batch.skippedDuplicates} 个重复选择` : "";
      setNotice(`本批 ${succeeded} 个文件上传成功${failed ? `，${failed} 个失败` : ""}${duplicateNote}；成功文件可逐个点击“处理”抽取正文。`);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const retryUpload = async (item: SourceUploadItem) => {
    if (!selected || busy === "upload" || item.status !== "failed") return;
    const projectId = selected.id;
    setBusy("upload");
    const updateItem = (updated: SourceUploadItem) => setSourceUploads((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate));
    try {
      const result = await retrySourceUploadItem(item, (file) => api.uploadSource(projectId, file), updateItem);
      if (result.status === "succeeded") {
        await loadDetail(projectId);
        setNotice(`“${item.name}”重新上传成功，可点击“处理”抽取正文。`);
      } else {
        setNotice(`“${item.name}”重新上传失败：${result.error || "请稍后再试"}`);
      }
    } catch (error) {
      setNotice(`“${item.name}”已重新上传，但资料台账刷新失败：${(error as Error).message}`);
    } finally {
      setBusy("");
    }
  };
  const addUrl = async () => { if (!selected || !url) return; setBusy("url"); try { await api.addUrl(selected.id, url); setUrl(""); await loadDetail(); setNotice("网页地址已加入来源台账；当前仅登记，内容尚未核验。 "); } catch (e) { setNotice((e as Error).message); } finally { setBusy(""); } };
  const resolve = async (a: ApprovalRequest, d: "accept" | "decline") => {
    setBusy(`approval-${a.id}`);
    try { await api.resolveApproval(a, d); await loadDetail(); setNotice(d === "accept" ? "已允许本次受控操作。" : "已拒绝本次受控操作，系统可继续采用安全替代方案。"); }
    catch (e) { setNotice((e as Error).message); }
    finally { setBusy(""); }
  };
  const updateProject = async (input: CreateProjectInput & { status: ResearchProject["status"] }) => {
    if (!selected) return;
    setBusy("project-settings");
    try {
      await api.updateProject(selected.id, input);
      await Promise.all([loadProjects(), loadDetail(selected.id)]);
      setProjectSettingsOpen(false);
      setNotice("课题信息已保存，并同步更新项目台与课题卡。");
    } catch (e) { setNotice((e as Error).message); }
    finally { setBusy(""); }
  };
  const createBackup = async () => {
    setBusy("backup");
    try { const result = await api.createBackup(); setNotice(`数据库一致性备份已生成：${result.path}`); await api.health().then(setHealth); }
    catch (e) { setNotice((e as Error).message); }
    finally { setBusy(""); }
  };
  const clearResearchData = async () => {
    setBusy("clear-data");
    try {
      const result = await api.clearResearchData();
      setProjects([]);
      setSelectedId(null);
      setDetail(null);
      setExportFiles([]);
      setExportPreview(null);
      setSourceUploads([]);
      setFocusedRunId(null);
      setUrl("");
      setInstructionsByView({});
      setClearDataOpen(false);
      await api.health().then(setHealth).catch(() => {});
      if (cloudMode) setNotice(`科研数据已清除：${result.counts.projects} 个课题、${result.counts.sources} 份资料和 ${result.storageObjects || 0} 个云端文件。模型 API Key 未受影响。`);
      else setNotice(`科研数据已清除：${result.counts.projects} 个课题。课题目录已移入 ${result.recoveryPath || "本地清理回收区"}，历史备份保留。`);
    } catch (e) {
      throw e;
    } finally { setBusy(""); }
  };
  const reviewRunById = async (runId: string, decision: ReviewDecision, note: string) => {
    setBusy(decision === "adopt" ? `review-adopt-${runId}` : `review-${decision}`);
    try {
      const result = await api.reviewRun(runId, decision, note);
      await Promise.all([loadDetail(), loadProjects()]);
      if (result.nextRun) setFocusedRunId(result.nextRun.id);
      setNotice(decision === "adopt" ? "已形成正式版本，并按状态机更新研究阶段。" : "本轮消息已保存，并在同一任务对话中创建了新回复。");
      return true;
    } catch (e) { setNotice((e as Error).message); return false; }
    finally { setBusy(""); }
  };
  const reviewRun = async (decision: ReviewDecision, note: string) => activeRun ? reviewRunById(activeRun.id, decision, note) : false;
  const adoptRun = (run: RunRecord) => { void reviewRunById(run.id, "adopt", ""); };
  const retryRun = async () => {
    if (!activeRun) return; setBusy("retry");
    try { const result = await api.retryRun(activeRun.id); await loadDetail(); setFocusedRunId(result.run.id); setNotice("已创建关联的重新运行，旧记录继续保留。"); }
    catch (e) { setNotice((e as Error).message); } finally { setBusy(""); }
  };
  const cancelRun = async () => {
    if (!activeRun) return; setBusy("cancel");
    try { const result = await api.cancelRun(activeRun.id); await loadDetail(); setNotice(result.alreadyFinished ? "运行已经结束，已刷新为最新真实状态。" : result.relatedRunIds && result.relatedRunIds.length > 1 ? `已停止共享同一后台任务的 ${result.relatedRunIds.length} 条重复运行记录。` : "运行已取消，状态已经保存。"); }
    catch (e) { setNotice((e as Error).message); } finally { setBusy(""); }
  };
  const deleteRun = async (run: RunRecord) => {
    const running = ["queued", "running", "waiting_approval"].includes(run.status);
    const warning = running
      ? `这条“${labels[run.skillName] || run.skillName}”任务仍在${run.status === "queued" ? "排队" : "运行"}。\n\n删除前将先取消后台任务，随后把运行记录和关联草稿移入项目回收站。确定继续吗？`
      : `确定删除这条“${labels[run.skillName] || run.skillName}”运行记录吗？\n\n关联草稿会移入项目回收站；已采用的正式版本不允许删除。`;
    if (!window.confirm(warning)) return;
    setBusy(`delete-run-${run.id}`);
    try {
      if (running) {
        await api.cancelRun(run.id);
      }
      await api.deleteRun(run.id);
      if (focusedRunId === run.id) setFocusedRunId(null);
      await Promise.all([loadDetail(), loadProjects()]);
      setNotice("运行记录已删除，关联草稿已转入项目回收站。");
    } catch (e) { setNotice((e as Error).message); }
    finally { setBusy(""); }
  };
  const previewExport = async (file: ExportFile) => {
    if (!selected) return;
    setPreviewBusy(file.relativePath);
    try { setExportPreview(await api.previewExport(selected.id, file.relativePath)); }
    catch (e) { setNotice((e as Error).message); }
    finally { setPreviewBusy(""); }
  };
  const exportProject = async (format: "markdown" | "docx" | "bibtex" | "latex" | "package", language: "zh" | "en") => {
    if (!selected) return;
    setBusy(format + language);
    try {
      const result = await api.exportProject(selected.id, format, language);
      const files = await loadExports(selected.id);
      const normalized = result.path.replaceAll("\\", "/");
      const created = files.find((file) => normalized.endsWith(file.relativePath));
      if (created) await previewExport(created);
      setNotice(`已导出：${result.path}`);
    } catch (e) { setNotice((e as Error).message); }
    finally { setBusy(""); }
  };
  const deleteExport = async (file: ExportFile) => {
    if (!selected || !window.confirm(`确定删除导出文件“${file.name}”吗？\n\n文件会移入项目回收站。`)) return;
    setBusy(`delete-export-${file.relativePath}`);
    try {
      await api.deleteExport(selected.id, file.relativePath);
      if (exportPreview?.file.relativePath === file.relativePath) setExportPreview(null);
      await loadExports(selected.id);
      setNotice("导出文件已转入项目回收站。");
    } catch (e) { setNotice((e as Error).message); }
    finally { setBusy(""); }
  };

  const page = () => {
    if (view === "skills") return canViewSkillsCatalog
      ? <SkillsCatalog health={health} onGo={setView}/>
      : <Empty title="需要管理员权限" body="科研 Skills 目录仅管理员可查看。"/>;
    if (view === "feedback") return <FeedbackPage project={selected} sourceView={feedbackOrigin} version={health?.app.version || ""}/>;
    if (view === "admin") return isAdmin ? <AdminConsole/> : <Empty title="需要管理员权限" body="当前账号不能访问用户与文件管理后台。"/>;
    if (view === "model") return <section className="workspace-section system-settings-page">
      <div className="page-heading"><div><span className="eyebrow">MODEL CONFIGURATION</span><h1>模型配置</h1><p>{cloudMode ? "选择默认模型，管理当前账号的模型 API 和连接配置。" : "查看本地模型连接方式。"}</p></div></div>
      <section className="system-settings-block">
        <div className="system-settings-block-head"><div><span className="eyebrow">MODEL CONFIGURATION</span><h2>个人模型</h2><p>{cloudMode ? "选择默认模型并管理当前账号自己的 API Key。" : "查看本地模型连接方式。"}</p></div></div>
        {cloudMode ? <div className="model-settings-page-card"><ModelSettingsContent/></div> : <div className="local-model-status"><div className="local-model-status-icon"><KeyRound/></div><div><span className="eyebrow">CURRENT EXECUTION MODE</span><h2>当前由 本地执行服务 提供模型</h2><p>本地版不需要在工作台重复填写 API Key，运行科研 Skill 时使用当前本地账号的模型额度。</p></div><span className="mode-chip">本地模式</span></div>}
      </section>
      {cloudMode && <section className="system-settings-block">
        <div className="system-settings-block-head"><div><span className="eyebrow">DOCUMENT PARSING</span><h2>PDF 解析服务</h2><p>为当前账号配置独立的 OCR 密钥，提升扫描件、表格、公式和多栏论文的解析效果。</p></div></div>
        <div className="model-settings-page-card"><OcrSettingsContent/></div>
      </section>}
    </section>;
    if (view === "system") return <section className="workspace-section system-settings-page">
      <div className="page-heading"><div><span className="eyebrow">ACCOUNT · SYSTEM</span><h1>系统设置</h1><p>管理当前账号、密码和工作台运行状态。</p></div><div className="page-heading-actions"><button className="button secondary" onClick={() => api.health().then(setHealth).catch((e) => setNotice(e.message))}><RefreshCw/>重新检查</button>{!cloudMode && <button className="button primary" disabled={busy === "backup"} onClick={createBackup}>{busy === "backup" ? <LoaderCircle className="spin"/> : <DatabaseBackup/>}备份运行数据</button>}</div></div>
      {cloudMode && <section className="system-account-card">
        <div className="system-account-avatar">{(sessionInfo?.username || "用").slice(0,1).toUpperCase()}</div>
        <div className="system-account-copy"><span className="eyebrow">CURRENT ACCOUNT</span><h2>{sessionInfo?.username || "当前账号"}</h2><p>{isAdmin ? "管理员账号，可管理用户与系统数据。" : "普通试用账号，数据与其他账号隔离。"}</p></div>
        <dl><div><dt>账号角色</dt><dd>{isAdmin ? "管理员" : "普通用户"}</dd></div><div><dt>账号状态</dt><dd>正常</dd></div></dl>
        <AccountPasswordSettings onNotice={setNotice}/>
        <button className="button secondary system-signout" onClick={() => void supabase?.auth.signOut()}><LogOut/>退出登录</button>
      </section>}
      <section className="system-settings-block">
        <div className="system-settings-block-head"><div><span className="eyebrow">SYSTEM READINESS</span><h2>运行状态与数据安全</h2><p>检查工作台、科研 Skills、用户资料和运行记录。</p></div></div>
        {health ? <><div className="health-grid">
          <div className="health-card"><span>工作台</span><strong className="ok"><Check/>已就绪</strong><code>v{health.app.version} · {cloudMode ? "在线服务" : `:${health.app.port}`}</code></div>
          <div className="health-card"><span>{cloudMode ? "个人模型" : "本地执行服务"}</span><strong className={health.codex.status === "ready" ? "ok" : "warn"}>{health.codex.status === "ready" ? <Check/> : <AlertTriangle/>}{health.codex.status === "ready" ? "ready" : "待配置"}</strong><code>{health.codex.cliVersion || health.codex.error}</code></div>
          <div className="health-card"><span>科研 Skills</span><strong className={health.skills.ready === health.skills.expected ? "ok" : "warn"}>{health.skills.ready}/{health.skills.expected}</strong><code>按研究阶段加载</code></div>
          <div className="health-card"><span>{cloudMode ? "用户资料" : "独立 Vault"}</span><strong className={health.vault.writable ? "ok" : "warn"}>{health.vault.writable ? <Check/> : <X/>}{health.vault.writable ? "可用" : "异常"}</strong><code>{health.vault.root}</code></div>
          <div className="health-card"><span>运行记录</span><strong className={health.database.integrity === "ok" ? "ok" : "warn"}>{health.database.integrity === "ok" ? <Check/> : <AlertTriangle/>}{health.database.integrity === "ok" ? "正常" : "异常"}</strong><code>{health.database.projects} 个课题 · {health.database.sources} 个来源 · {health.database.runs} 次运行</code></div>
          <div className="health-card"><span>活动任务</span><strong className={health.database.pendingApprovals ? "warn" : "ok"}>{health.database.pendingApprovals ? <LoaderCircle/> : <Check/>}{health.database.pendingApprovals}</strong><code>排队中或运行中的任务</code></div>
        </div><div className="system-boundary"><ShieldCheck/><div><strong>试用边界</strong><p>{cloudMode ? "工作台不会自动投稿、发信、支付或替作者确认实验事实。API Key 加密保存；模型费用由所选服务商规则决定。" : "工作台不会自动投稿、发送邮件、支付费用或替作者确认实验事实。备份只保存本地运行数据；科研 Vault 仍按原目录保留。"}</p></div></div></> : <LoaderCircle className="spin"/>}
      </section>
      <section className="system-settings-block data-management-section">
        <div className="system-settings-block-head"><div><span className="eyebrow">DATA MANAGEMENT</span><h2>清除科研数据</h2><p>清理当前账号的课题数据；账号和模型连接会继续保留。</p></div></div>
        <div className="data-management-card"><div className="data-management-icon"><Trash2/></div><div className="data-management-copy"><strong>{cloudMode ? "永久清除在线科研数据" : "清理本地科研数据"}</strong><p>{cloudMode ? "课题、资料、证据、运行记录、正式版本、导出文件和反馈会从云端删除，Storage 文件也会一并清理。" : "课题、资料和运行记录会从工作台移除；项目目录先移入 Vault/99-system/trash/cleared-data，SQLite 历史备份不删除。"}</p><span>不会删除账号、密码、模型 API Key 或 PaddleOCR Key。</span></div><button className="button danger" onClick={() => setClearDataOpen(true)} disabled={busy === "clear-data"}><Trash2/>清除数据</button></div>
      </section>
      {clearDataOpen && <ClearResearchDataDialog
        cloud={cloudMode}
        busy={busy === "clear-data"}
        onClose={() => { if (busy !== "clear-data") setClearDataOpen(false); }}
        onConfirm={clearResearchData}
      />}
    </section>;
    if (!selected) return <Empty title="从第一个课题开始" body="创建课题后，工作台会把资料、AI 草稿、人工确认和正式成果分层保存。" action={<button className="button primary" onClick={() => setCreateOpen(true)}><Plus/>创建课题</button>}/>;
    if (view === "overview") {
      const next = !projectStats.sources
        ? { number: "01", title: "先补充可信资料", body: "上传已有文献、课题说明或登记网页来源，先建立证据边界。", view: "sources" as View }
        : selected.stage === "brief"
          ? { number: "02", title: "开始 Idea 可行性评估", body: "让 Skill 根据时间、资源与研究缺口给出决策建议。", view: "idea" as View }
          : selected.stage === "research"
            ? { number: "03", title: "进入深度文献调研", body: "围绕已采用的研究判断组织检索、证据、冲突和研究缺口。", view: "research" as View }
          : selected.stage === "blueprint"
            ? { number: "04", title: "完善论文蓝图", body: "把已确认的证据和研究贡献转成可执行的论文结构。", view: "blueprint" as View }
            : selected.stage === "writing"
              ? { number: "05", title: "进入章节级写作", body: "以已采用蓝图为边界，逐章生成、审阅并采用正式版本。", view: "writing" as View }
              : selected.stage === "production"
                ? { number: "06", title: "完成图表与整稿", body: "核对语义变化、真实数据、图表标注和整稿装配关系。", view: "production" as View }
                : selected.stage === "review"
                  ? { number: "07", title: "执行投稿前审查", body: "分级处理论证、实验、引用、格式和可复现性问题。", view: "review" as View }
                  : { number: "08", title: "导出正式研究成果", body: "只使用已经人工采用的正式版本生成可审查文件。", view: "export" as View };
      return <>
      <section className="hero"><div><span className="eyebrow">RESEARCH EVIDENCE SPINE</span><h1>{selected.name}</h1><p>{selected.goal}</p></div><div className="hero-actions"><button className="button secondary" onClick={() => setProjectSettingsOpen(true)}><Settings/>编辑课题</button>{cloudMode ? <span className="cloud-hero-badge"><ShieldCheck/>账号专属空间</span> : <button className="button secondary" onClick={() => api.openCodex(selected.id).catch((e) => setNotice(e.message))}><ExternalLink/>在本地客户端打开</button>}</div></section>
      <StageSpine project={selected}/>
      {detail && <ReadinessPanel detail={detail} onGo={setView}/>} 
      <div className="metric-row"><div><span>原始资料</span><strong>{projectStats.sources}</strong><small>文件与网址</small></div><div><span>Skill 运行</span><strong>{projectStats.runs}</strong><small>全部留痕</small></div><div><span>人工待办</span><strong>{projectStats.approvals}</strong><small>{projectStats.reviews ? `${projectStats.reviews} 个草稿待审阅` : "审批与内容审阅"}</small></div></div>
      <div className="content-grid"><section className="paper-card"><div className="section-title"><div><span className="eyebrow">NEXT GATE</span><h2>下一步建议</h2></div><ChevronRight/></div><div className="next-step"><div className="step-number">{next.number}</div><div><h3>{next.title}</h3><p>{next.body}</p><button className="text-link" onClick={() => setView(next.view)}>进入此环节 <ArrowRight/></button></div></div></section><section className="paper-card compact"><span className="eyebrow">{cloudMode ? "PERSONAL WORKSPACE" : "LOCAL FIRST"}</span><h2>项目证据目录</h2><code>{selected.projectPath}</code><p>原始资料只读，AI 输出先进入草稿层。正式版本由你确认。</p></section></div>
    </>;
    }
    if (view === "sources") return <SourceWorkspace project={selected} detail={detail} busy={busy} uploadItems={sourceUploads} url={url} setUrl={setUrl} onUpload={upload} onRetryUpload={retryUpload} onAddUrl={addUrl} onReload={() => loadDetail().then(() => undefined)} onNotice={setNotice}/>;
     if (view === "workflow") return <section className="workspace-section"><div className="page-heading"><div><span className="eyebrow">RESEARCH ROUTING</span><h1>研究路线</h1><p>判断课题当前所处阶段，把模糊目标拆成可执行路线，并明确工具选择和研究红线。</p></div></div><CodexRunWorkspace title="研究工作流" eyebrow="RESEARCH ROUTING" description="先把当前进度、障碍和可用证据说清楚，再生成可执行的研究路线。" sidebar={<><span className="codex-rail-section-title">任务提示</span><TaskHint skill="vibe-research-workflow" value={instructions} onFill={setInstructions}/><p className="codex-rail-note">路线建议只形成草稿；是否推进研究阶段仍由你确认。</p></>} promptValue={instructions} onPromptChange={setInstructions} onSubmit={(message) => runAction("vibe-research-workflow", message)} submitLabel="运行研究工作流" submitIcon={busy === "vibe-research-workflow" ? <LoaderCircle className="spin" size={17}/> : <FolderKanban size={17}/>} disabled={busy === "vibe-research-workflow" || projectHasActiveRun} runs={relevantRuns} activeRunId={activeRun?.id || null} onSelectRun={setFocusedRunId} run={activeRun} approvals={detail?.approvals || []} busy={busy} onReview={reviewRun} onRetry={retryRun} onCancel={cancelRun} onResolve={resolve}/><StageHistory stage="brief" runs={relevantRuns} versions={detail?.versions || []} activeRunId={activeRun?.id || null} busy={busy} onSelect={setFocusedRunId} onAdopt={adoptRun} onDelete={deleteRun}/></section>;
     if (view === "idea") return <section className="workspace-section"><div className="page-heading"><div><span className="eyebrow">DECISION BEFORE EXECUTION</span><h1>Idea 可行性评估</h1><p>先判断值不值得做，再投入完整调研和写作。</p></div></div><CodexRunWorkspace title="Idea 可行性评估" eyebrow="DECISION BEFORE EXECUTION" description="把研究问题、投入约束和资源条件放进同一个对话，再决定是否继续投入。" sidebar={<div className="codex-rail-form"><span className="codex-rail-section-title">评估参数</span><TaskHint skill="idea-evaluator" value={idea.idea} onFill={(value) => setIdea({ ...idea, idea: value })}/><label>每周投入 小时<input type="number" min="1" value={idea.weeklyHours} onChange={(e) => setIdea({ ...idea, weeklyHours: Number(e.target.value) })}/></label><label>计划周期 月<input type="number" min="1" value={idea.timelineMonths} onChange={(e) => setIdea({ ...idea, timelineMonths: Number(e.target.value) })}/></label><label>已有技能<input value={idea.skills} onChange={(e) => setIdea({ ...idea, skills: e.target.value })} placeholder="研究方法、编程、实验能力"/></label><label>已有资源<input value={idea.resources} onChange={(e) => setIdea({ ...idea, resources: e.target.value })} placeholder="数据、设备、合作导师、经费"/></label><label>目标期刊或会议<input value={idea.targetVenue} onChange={(e) => setIdea({ ...idea, targetVenue: e.target.value })} placeholder="不确定可留空"/></label></div>} promptValue={idea.idea} onPromptChange={(value) => setIdea({ ...idea, idea: value })} onSubmit={(message) => runAction("idea-evaluator", { ...idea, idea: message })} submitLabel="开始评估" submitIcon={busy === "idea-evaluator" ? <LoaderCircle className="spin" size={17}/> : <BrainCircuit size={17}/>} disabled={busy === "idea-evaluator" || projectHasActiveRun} runs={relevantRuns} activeRunId={activeRun?.id || null} onSelectRun={setFocusedRunId} run={activeRun} approvals={detail?.approvals || []} busy={busy} onReview={reviewRun} onRetry={retryRun} onCancel={cancelRun} onResolve={resolve}/><StageHistory stage="idea" runs={relevantRuns} versions={detail?.versions || []} activeRunId={activeRun?.id || null} busy={busy} onSelect={setFocusedRunId} onAdopt={adoptRun} onDelete={deleteRun}/></section>;
    if (view === "research" || view === "blueprint") {
      const skill = view === "research" ? "deep-research" : selected.paperType === "benchmark" ? "benchmark-paper-template" : "tech-paper-template";
      return <section className="workspace-section"><div className="page-heading"><div><span className="eyebrow">{view === "research" ? "EVIDENCE SYNTHESIS" : "PAPER ARCHITECTURE"}</span><h1>{view === "research" ? "深度文献调研" : "论文蓝图"}</h1><p>{view === "research" ? "围绕已确认问题组织检索、证据、冲突和研究缺口。" : "把已采用的 Idea 与调研结果转成可执行的论文结构。"}</p></div></div><CodexRunWorkspace title={view === "research" ? "深度文献调研" : "论文蓝图"} eyebrow={view === "research" ? "EVIDENCE SYNTHESIS" : "PAPER ARCHITECTURE"} description={view === "research" ? "围绕已确认问题组织检索、证据、冲突和研究缺口。" : "把已采用的 Idea 与调研结果转成可执行的论文结构。"} sidebar={<><span className="codex-rail-section-title">当前科研 Skill</span><strong className="codex-rail-skill">{labels[skill]}</strong><TaskHint skill={skill} value={instructions} onFill={setInstructions}/><p className="codex-rail-note">{cloudMode ? "在线版只使用已登记资料与已核验证据。" : "受控操作会在运行过程中请求人工审批。"}</p></>} promptValue={instructions} promptPlaceholder={view === "research" ? "说明调研主题、文献范围、重点比较的问题，以及希望得到的对比表和待核验清单。" : "说明论文主题、章节结构、研究范围、所需实验和图表；没有实验结果时请保留待补项。"} onPromptChange={setInstructions} onSubmit={(message) => runAction(skill, message)} submitLabel={`运行${labels[skill]}`} submitIcon={busy === skill ? <LoaderCircle className="spin" size={17}/> : <FlaskConical size={17}/>} disabled={busy === skill || projectHasActiveRun} runs={relevantRuns} activeRunId={activeRun?.id || null} onSelectRun={setFocusedRunId} run={activeRun} approvals={detail?.approvals || []} busy={busy} onReview={reviewRun} onRetry={retryRun} onCancel={cancelRun} onResolve={resolve}/><StageHistory stage={view as "research" | "blueprint"} runs={relevantRuns} versions={detail?.versions || []} activeRunId={activeRun?.id || null} busy={busy} onSelect={setFocusedRunId} onAdopt={adoptRun} onDelete={deleteRun}/></section>;
    }
    if (["writing", "production", "review"].includes(view)) {
      const currentView = view as "writing" | "production" | "review";
      const config = {
        writing: { eyebrow: "CHAPTER PRODUCTION · PHASE 2B", title: "章节级写作", body: "以已采用蓝图和核验证据为边界，逐章生成、审阅和采用。", skills: ["intro-drafter", "paper-writer"], stage: "writing" as const, placeholder: "写明目标章节、真实实验材料、目标字数、引用边界和必须保留的待补项" },
        production: { eyebrow: "MANUSCRIPT & FIGURES · PHASE 2C", title: "图表与整稿", body: "润色、图表设计和 Draw.io 重建都先形成草稿，再由你确认语义、数据和标注。", skills: ["paper-polish", "figure-designer", "drawio-reconstruction"], stage: "production" as const, placeholder: "说明正文或参考图位置、真实数据、图意、尺寸、不可改变项和验收标准" },
        review: { eyebrow: "SUBMISSION GATE · PHASE 2D", title: "投稿审查与回应", body: "在投稿前分级发现问题；收到评审意见后逐条规划回应，最终决定仍由作者作出。", skills: ["pre-submission-reviewer", "rebuttal-guidance"], stage: "review" as const, placeholder: "填写目标期刊/会议、格式要求、审查重点，或粘贴审稿意见与回复期限" },
      }[currentView];
      const skill = lifecycleSkills[currentView];
      return <section className="workspace-section"><div className="page-heading"><div><span className="eyebrow">{config.eyebrow}</span><h1>{config.title}</h1><p>{config.body}</p></div></div><CodexRunWorkspace title={config.title} eyebrow={config.eyebrow} description={config.body} sidebar={<div className="codex-rail-form"><span className="codex-rail-section-title">选择科研 Skill</span><select value={skill} onChange={(event) => setLifecycleSkills({ ...lifecycleSkills, [currentView]: event.target.value })}>{config.skills.map((name) => <option key={name} value={name}>{labels[name]}</option>)}</select><TaskHint skill={skill} value={instructions} onFill={setInstructions}/><p className="codex-rail-note">没有真实数据时必须保留待补项；正式版本仍需人工确认。</p></div>} promptValue={instructions} promptPlaceholder={config.placeholder} onPromptChange={setInstructions} onSubmit={(message) => runAction(skill, message)} submitLabel={`运行${labels[skill]}`} submitIcon={busy === skill ? <LoaderCircle className="spin" size={17}/> : <FlaskConical size={17}/>} disabled={busy === skill || projectHasActiveRun} runs={relevantRuns} activeRunId={activeRun?.id || null} onSelectRun={setFocusedRunId} run={activeRun} approvals={detail?.approvals || []} busy={busy} onReview={reviewRun} onRetry={retryRun} onCancel={cancelRun} onResolve={resolve}/><StageHistory stage={config.stage} runs={relevantRuns} versions={detail?.versions || []} activeRunId={activeRun?.id || null} busy={busy} onSelect={setFocusedRunId} onAdopt={adoptRun} onDelete={deleteRun}/></section>;
    }
    if (view === "export") return <section className="workspace-section export-workspace">
      <div className="page-heading"><div><span className="eyebrow">REVIEWABLE OUTPUT</span><h1>导出研究成果</h1><p>先生成需要的版本，再从下方真实文件库预览或下载。所有文件都来自当前课题的导出目录。</p></div></div>
      <div className="export-grid">{(["zh", "en"] as const).flatMap((language) => (["markdown", "docx"] as const).map((format) => {
        const key = format + language;
        return <button className="export-card" disabled={Boolean(busy)} key={language + format} onClick={() => exportProject(format, language)}><div className="export-icon">{busy === key ? <LoaderCircle className="spin"/> : format === "docx" ? <FileText/> : <ScrollText/>}</div><span>{language === "zh" ? "中文" : "English"}</span><h3>{format === "docx" ? "Word 研究方案" : "Markdown 研究方案"}</h3><p>{language === "en" ? (busy === key ? "正在逐段翻译并生成，请勿重复点击…" : "使用当前模型翻译全文，会消耗 API 额度") : format === "docx" ? "适合导师审阅和正式流转" : "适合 Obsidian 继续维护"}</p><ArrowRight/></button>;
      }))}<button className="export-card" disabled={busy === "bibtexzh"} onClick={() => exportProject("bibtex", "zh")}><div className="export-icon"><FileText/></div><span>REFERENCES</span><h3>BibTeX 引用库</h3><p>只导出已核验且包含题名的来源</p><ArrowRight/></button><button className="export-card" disabled={busy === "latexzh"} onClick={() => exportProject("latex", "zh")}><div className="export-icon"><ScrollText/></div><span>MANUSCRIPT SOURCE</span><h3>LaTeX 正式稿</h3><p>装配当前有效的人工采用版本</p><ArrowRight/></button><button className="export-card" disabled={busy === "packagezh"} onClick={() => exportProject("package", "zh")}><div className="export-icon">{busy === "packagezh" ? <LoaderCircle className="spin"/> : <PackageCheck/>}</div><span>DELIVERY PACKAGE</span><h3>科研交付包</h3><p>正式版本、已核验来源清单与限制说明</p><ArrowRight/></button></div>
      <div className="export-library-head"><div><span className="eyebrow">PROJECT FILE LIBRARY</span><h2>已生成文件</h2><p>{exportFiles.length ? `当前课题共有 ${exportFiles.length} 个可用导出文件，按生成时间从新到旧排列。` : "尚未发现可用导出文件。"}</p></div><button className="button secondary small" onClick={() => loadExports().catch((e) => setNotice(e.message))}><RefreshCw/>刷新文件</button></div>
      <div className="export-library">
        <div className="export-file-list">{exportFiles.length ? exportFiles.map((file) => <article className={`export-file ${exportPreview?.file.relativePath === file.relativePath ? "active" : ""}`} key={file.relativePath}>
          <div className={`file-format ${file.format}`}>{file.format === "package" ? <PackageCheck/> : file.format === "docx" || file.format === "bibtex" ? <FileText/> : <ScrollText/>}<span>{file.format === "docx" ? "DOCX" : file.format === "bibtex" ? "BIB" : file.format === "latex" ? "TEX" : file.format === "package" ? "ZIP" : "MD"}</span></div>
          <div className="file-summary"><strong title={file.name}>{file.name}</strong><div><span className={`export-release ${file.releaseStatus}`}>{file.releaseStatus === "formal" ? "正式版本" : file.releaseStatus === "draft" ? "草稿" : "旧版导出"}</span><span>{fileLanguage(file.language)}</span><span>{fileSize(file.size)}</span><span><Clock3/>{relativeDate(file.modifiedAt)}</span></div><code title={file.relativePath}>{file.relativePath}</code></div>
          <div className="file-actions"><button className="file-preview-button" onClick={() => previewExport(file)} disabled={previewBusy === file.relativePath}>{previewBusy === file.relativePath ? <LoaderCircle className="spin"/> : <Eye/>}<span>预览</span></button><button className="file-download" onClick={() => api.downloadExport(selected.id, file.relativePath, file.name).catch((e) => setNotice(e.message))}><Download/><span>下载</span></button><button className="file-delete" onClick={() => deleteExport(file)} disabled={busy === `delete-export-${file.relativePath}`}><Trash2/><span>删除</span></button></div>
        </article>) : <Empty title="还没有导出文件" body="从上方选择语言和格式生成后，文件会自动出现在这里。"/>}</div>
        <aside className="export-preview" aria-live="polite">{exportPreview ? <>
          <div className="preview-head"><div><span className="eyebrow">DOCUMENT PREVIEW</span><h3>{exportPreview.file.name}</h3><div className="preview-meta"><span>{exportPreview.file.format === "docx" ? "Word" : exportPreview.file.format === "package" ? "交付包清单" : exportPreview.file.format.toUpperCase()}</span><span>{fileLanguage(exportPreview.file.language)}</span><span>{fileSize(exportPreview.file.size)}</span></div></div><button className="button secondary small" onClick={() => api.downloadExport(selected.id, exportPreview.file.relativePath, exportPreview.file.name).catch((e) => setNotice(e.message))}><Download/>下载</button></div>
          {exportPreview.note && <div className="preview-note"><ShieldCheck/>{exportPreview.note}</div>}
          <div className={`preview-paper ${exportPreview.kind}`}><ResultDocument content={exportPreview.content || "该文件没有可显示的正文内容。"}/></div>
        </> : <div className="preview-placeholder"><Eye/><span className="eyebrow">READING DESK</span><h3>选择左侧文件开始预览</h3><p>Markdown 显示原始正文；Word 提取正文供快速检查，最终分页与版式以下载文件为准。</p></div>}</aside>
      </div>
    </section>;
    return <Empty title="页面暂不可用" body="请从左侧选择一个工作区。"/>;
  };

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "open" : ""}`}><div className="brand"><div className="brand-mark"><FlaskConical/></div><div><strong>科研工作台</strong><span>AI RESEARCH WORKBENCH</span></div></div><button className="button new-project" onClick={() => setCreateOpen(true)}><Plus/>新建课题</button><nav>{nav.filter((item) => (item.id !== "admin" || isAdmin) && (item.id !== "skills" || canViewSkillsCatalog)).map((item) => { if (item.id === "contact") return <ContactBlogger key={item.id} variant="sidebar" onOpen={() => setMobileNav(false)}/>; const Icon = item.icon; return <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => { if (item.id === "feedback" && view !== "feedback") setFeedbackOrigin(view); setView(item.id as View); setMobileNav(false); }}><Icon/><span>{item.label}</span>{item.id === "model" && health && <i className={health.codex.status === "ready" ? "online" : "offline"}/>}</button>; })}</nav><div className="sidebar-bottom"><div className="local-badge"><ShieldCheck/><div><strong>{isAdmin ? "管理员模式" : cloudMode ? "租户数据隔离" : "本地证据优先"}</strong><span>{isAdmin ? "跨用户操作全程审计" : "人工确认关键节点"}</span></div></div><button className="theme-toggle" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? <Moon/> : <Sun/>}<span>{theme === "light" ? "深色模式" : "浅色模式"}</span></button></div></aside>
    <main><header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(!mobileNav)}><Menu/></button><div className="project-switch"><span>当前课题</span><select value={selectedId || ""} disabled={busy === "upload"} onChange={(e) => { setSelectedId(e.target.value || null); setSourceUploads([]); }}><option value="">尚未创建课题</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.status === "paused" ? "（已暂停）" : p.status === "completed" ? "（已完成）" : ""}</option>)}</select></div><div className="top-actions"><span className={`connection ${health?.codex.status === "ready" ? "ready" : ""}`}><i/>{cloudMode ? health?.codex.status === "ready" ? "模型已配置" : "模型待配置" : health?.codex.status === "ready" ? "服务已连接" : "服务连接中"}</span></div></header><div className="page-canvas">{notice && <div className="notice" onClick={() => setNotice("")}>{notice}<X size={16}/></div>}{page()}</div></main>
    {createOpen && <CreateProject onClose={() => setCreateOpen(false)} onCreated={created}/>} 
    {projectSettingsOpen && selected && <ProjectSettings project={selected} busy={busy === "project-settings"} onSave={updateProject} onClose={() => setProjectSettingsOpen(false)}/>} 
    {onboardingStep && <OnboardingGuide step={onboardingStep} onSkip={() => { if (sessionInfo) localStorage.setItem(`research-model-onboarding-skipped:${sessionInfo.id}`, "1"); setOnboardingStep(null); }} onSignOut={() => void supabase?.auth.signOut()}/>} 
  </div>;
}

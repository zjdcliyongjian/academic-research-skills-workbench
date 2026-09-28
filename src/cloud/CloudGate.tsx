import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowRight, BarChart3, BookOpen, CheckCircle2, Eye, EyeOff, FileOutput, FolderKanban, KeyRound, LoaderCircle, LockKeyhole, Mail, Map, PenLine, Power, Save, Search, Trash2 } from "lucide-react";
import { api, type OcrConfig } from "../api";
import { PASSWORD_RULE_MESSAGE, passwordRuleError, resolveAuthIdentity, trialLoginEmail } from "./authValidation";
import { cloudConfigurationError, cloudMode, supabase } from "./supabase";
import { ContactBlogger } from "./ContactBlogger";

type ProviderConfig = { id: string; provider: string; model: string; baseUrl: string; keyHint: string; isDefault: boolean };

const providers = [
  ["volcengine_agent_plan", "火山方舟 Agent Plan", "https://ark.cn-beijing.volces.com/api/plan/v3"],
  ["deepseek", "DeepSeek", "https://api.deepseek.com"],
  ["kimi", "Kimi 开放平台（中国站）", "https://api.moonshot.cn/v1"],
  ["kimi_code", "Kimi Code（会员额度）", "https://api.kimi.com/coding/v1"],
  ["zhipu", "智谱 GLM", "https://open.bigmodel.cn/api/paas/v4"],
  ["gemini", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai"],
  ["openai", "OpenAI", "https://api.openai.com/v1"],
  ["anthropic", "Anthropic Claude", "https://api.anthropic.com/v1"],
] as const;

const providerModels: Record<string, string[]> = {
  volcengine_agent_plan: ["deepseek-v4.1-flash", "ark-code-latest"],
  anthropic: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001"],
  openai: ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4"],
  gemini: ["gemini-3.8-flash", "gemini-3.5-flash"],
  zhipu: ["glm-5.3", "glm-5.2"],
  kimi: ["kimi-k3", "kimi-k2.6"],
  kimi_code: ["kimi-for-coding"],
  deepseek: ["deepseek-flash"],
};

const modelLabels: Record<string, string> = {
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-opus-5": "Claude Opus 5",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
  "gpt-6-astra": "GPT-6-Astra",
  "gpt-5.6-sol": "GPT-5.6-Sol",
  "gpt-5.6-terra": "GPT-5.6-Terra",
  "gpt-5.6-luna": "GPT-5.6-Luna",
  "gpt-5.5": "GPT-5.5",
  "gpt-5.4": "GPT-5.4",
  "gemini-3.8-flash": "Gemini-3.8-Flash",
  "gemini-3.5-flash": "Gemini-3.5-Flash",
  "gemini-3.5-flash-lite": "Gemini-3.5-Flash-Lite",
  "glm-5.3": "GLM-5.3",
  "glm-5.2": "GLM-5.2",
  "kimi-k3": "Kimi-K3",
  "kimi-k2.6": "Kimi-K2.6",
  k3: "Kimi-K3",
  "k3-256k": "Kimi-K3-256K",
  "kimi-for-coding": "Kimi-K2.8-Preview",
  "kimi-for-coding-highspeed": "Kimi-K2.7-Code-HighSpeed",
  "deepseek-flash": "DeepSeek-V4.1-Flash",
  "deepseek-v4.1-flash": "火山方舟 Agent Plan · DeepSeek-V4.1-Flash",
  "ark-code-latest": "火山方舟 Agent Plan · 自动选择最新编程模型",
};

function defaultModel(provider: string) {
  return providerModels[provider]?.[0] || "";
}

function modelOptionLabel(model: string) {
  return modelLabels[model] || model;
}

function AuthPanel() {
  const [register, setRegister] = useState(false);
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [visualTheme, setVisualTheme] = useState<"editorial" | "cosmic" | "ice">(() => {
    const requestedTheme = new URLSearchParams(window.location.search).get("theme");
    return requestedTheme === "cosmic" || requestedTheme === "ice" ? requestedTheme : "editorial";
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const identity = resolveAuthIdentity(account);
    if (!identity) { setMessage("请输入有效的中国大陆手机号或邮箱地址。"); return; }
    if (register && identity.kind === "admin") { setMessage("admin 是系统保留管理员账号，不能在注册页创建。"); return; }
    const passwordError = passwordRuleError(password);
    if (passwordError) { setMessage(passwordError); return; }
    setBusy(true); setMessage("");
    try {
      if (register) await api.trialRegister({ account: identity.account, password });
      const loginEmail = await trialLoginEmail(identity);
      const result = await supabase.auth.signInWithPassword({ email: loginEmail, password });
      if (result.error) throw result.error;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "登录失败";
      if (/invalid login credentials/i.test(detail)) setMessage("账号或密码不正确。");
      else setMessage(detail);
    }
    finally { setBusy(false); }
  }

  const changeMode = (nextRegister: boolean) => { setRegister(nextRegister); setMessage(""); };

  return <div className={`cloud-auth-page is-${visualTheme}`}>
    <div className="cloud-auth-scene" aria-hidden="true"/>
    <header className="cloud-auth-topbar">
      <div className="cloud-brand-lockup"><span className="cloud-brand-symbol"><i/><i/><i/><i/></span><div><strong>科研工作台</strong><small>AI RESEARCH WORKBENCH</small></div></div>
      <p>让科研更高效 · 让知识创造更大价值</p>
      <span className="cloud-auth-topline">探索科学的边界 · 与 AI 共赴未知<i/></span>
      <div className="cloud-auth-theme-picker" role="group" aria-label="登录页视觉主题">
        {([['editorial', '经典'], ['cosmic', '深空'], ['ice', '晶白']] as const).map(([theme, label]) => <button key={theme} type="button" className={visualTheme === theme ? "active" : ""} onClick={() => setVisualTheme(theme)} aria-pressed={visualTheme === theme}>{label}</button>)}
      </div>
    </header>
    <section className="cloud-auth-brand">
      <div className="cloud-auth-copy">
        <span className="eyebrow">AI RESEARCH WORKBENCH</span>
        <h1>{visualTheme === "editorial" ? <>科研过程可追溯，<br/><em>关键结论由人确认。</em></> : visualTheme === "cosmic" ? <><em>AI 驱动的</em><br/>一站式科研工作台</> : <>让研究，<br/>从复杂信息中找到答案</>}</h1>
        <p>{visualTheme === "editorial" ? <>从课题、资料到论证与写作，<br/>把分散的科研过程沉淀为可复核、可继续的知识资产。</> : visualTheme === "cosmic" ? <>汇聚研究资料，连接研究思路，<br/>用 AI 加速科学发现。</> : <>用 AI 连接科学知识，<br/>加速人类的探索与发现。</>}</p>
      </div>
      {visualTheme === "editorial" ? <><div className="cloud-auth-capabilities cloud-auth-editorial-capabilities">
        <article><span><FolderKanban/></span><strong>课题管理</strong><small>目标、进度与节点统一组织</small></article>
        <article><span><BookOpen/></span><strong>资料与证据</strong><small>来源清晰，结论可回溯</small></article>
        <article><span><Map/></span><strong>研究路线</strong><small>从问题到验证逐步推进</small></article>
        <article><span><FileOutput/></span><strong>成果导出</strong><small>沉淀为可审阅研究资产</small></article>
      </div>
      <blockquote>“研究，始于思考，成于积累。”<small>RESEARCH BEGINS WITH QUESTIONS</small></blockquote></> : visualTheme === "cosmic" ? <><div className="cloud-auth-capabilities">
        <article><span><Search/></span><strong>文献检索</strong><small>汇集资料，溯源核验</small></article>
        <article><span><BookOpen/></span><strong>AI 阅读</strong><small>梳理脉络，提炼要点</small></article>
        <article><span><BarChart3/></span><strong>数据分析</strong><small>组织证据，发现联系</small></article>
        <article><span><PenLine/></span><strong>科研写作</strong><small>从思路到可审阅草稿</small></article>
      </div>
      <blockquote>“AI 不是替代科研人员，<br/>而是让每一个好问题走得更远。”<small>FOR A MORE OPEN SCIENCE</small></blockquote></> : <div className="cloud-auth-ice-summary"><strong>文献　·　数据　·　实验　·　知识　·　AI</strong><i/><span>SCIENCE EMPOWERS A BRIGHTER TOMORROW</span></div>}
    </section>
    <form className="cloud-auth-card" onSubmit={submit}>
      <span className="cloud-auth-language">简体中文⌄</span>
      <div className="cloud-auth-card-brand"><span className="cloud-brand-symbol"><i/><i/><i/><i/></span><div><strong>科研工作台</strong><small>AI 让科研更简单</small></div></div>
      <div className="cloud-auth-tabs" role="tablist" aria-label="账号操作">
        <button type="button" className={!register ? "active" : ""} onClick={() => changeMode(false)}>账号登录</button>
        <button type="button" className={register ? "active" : ""} onClick={() => changeMode(true)}>注册试用</button>
      </div>
      <label className="cloud-auth-field"><span>账号</span><div><Mail/><input required maxLength={254} value={account} onChange={(event) => setAccount(event.target.value.slice(0, 254))} autoCapitalize="none" autoComplete="username" placeholder="手机号 / 邮箱"/></div></label>
      <label className="cloud-auth-field"><span>密码</span><div><LockKeyhole/><input type={showPassword ? "text" : "password"} minLength={8} maxLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={register ? "new-password" : "current-password"} placeholder="8–12 位，含字母、数字和特殊字符" title={PASSWORD_RULE_MESSAGE}/><button type="button" className="cloud-auth-password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? <EyeOff/> : <Eye/>}</button></div></label>
      <div className="cloud-auth-meta"><span>本期试用免短信与邮件验证</span>{!register && <button type="button" onClick={() => setMessage("本期试用不发送短信或验证邮件。普通账号请联系管理员核验身份后重置临时密码；管理员账号请由系统所有者执行安全恢复流程。")}>忘记密码？</button>}</div>
      {message && <p className="cloud-auth-message">{message}</p>}
      <button className="cloud-auth-submit" disabled={busy}>{busy ? <LoaderCircle className="spin"/> : <KeyRound/>}<span>{register ? "创建试用账号" : "登录"}</span>{!busy && <ArrowRight/>}</button>
      <p className="cloud-auth-rule">{register ? "账号注册后即可使用，不发送验证码。" : "使用手机号或邮箱账号登录。"}{PASSWORD_RULE_MESSAGE}</p>
      <button type="button" className="cloud-auth-switch" onClick={() => changeMode(!register)}>{register ? "已有账号？返回登录" : "没有账号？立即注册"}</button>
      <ContactBlogger/>
      <small className="cloud-auth-card-foot">科研，让世界更好 · SCIENCE FOR A BETTER TOMORROW</small>
    </form>
    <footer className="cloud-auth-footer"><strong>KNOWLEDGE CONNECTS A BRIGHTER TOMORROW</strong><span>知识连接更美好的未来</span></footer>
  </div>;
}

export function ModelSettingsContent() {
  const [items, setItems] = useState<ProviderConfig[]>([]);
  const [provider, setProvider] = useState("volcengine_agent_plan");
  const [model, setModel] = useState(defaultModel("volcengine_agent_plan"));
  const [baseUrl, setBaseUrl] = useState<string>(providers.find((item) => item[0] === "volcengine_agent_plan")?.[2] || "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [workingId, setWorkingId] = useState("");
  const [message, setMessage] = useState("");
  const load = () => api.cloudProviders().then((r) => setItems(r.items)).catch((e) => setMessage(e.message));
  useEffect(() => { void load(); }, []);
  const chooseModel = (value: string) => {
    const separator = value.indexOf("::");
    const nextProvider = separator >= 0 ? value.slice(0, separator) : "openai";
    const nextModel = separator >= 0 ? value.slice(separator + 2) : defaultModel("openai");
    setProvider(nextProvider);
    setBaseUrl(providers.find((item) => item[0] === nextProvider)?.[2] || "");
    setModel(nextModel);
    setMessage("");
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const requestedModel = model.trim();
      let savedModel = requestedModel;
      let available: string[] = [];
      let candidates = [requestedModel];
      if (["kimi", "kimi_code"].includes(provider)) {
        const result = await api.discoverCloudProviderModels({ provider, baseUrl, apiKey });
        available = [...new Set(result.models.filter(Boolean))];
        const recommendedAvailable = (providerModels[provider] || []).filter((item) => available.includes(item));
        candidates = [...new Set([
          ...(available.includes(requestedModel) ? [requestedModel] : []),
          ...recommendedAvailable,
        ])];
        if (!candidates.length) throw new Error("当前 API Key 没有返回可用的 Kimi 文本模型");
      }
      let lastError: unknown = null;
      for (const candidate of candidates) {
        try {
          await api.saveCloudProvider({ provider, model: candidate, baseUrl, apiKey });
          savedModel = candidate; lastError = null; break;
        } catch (error) {
          lastError = error;
          const detail = error instanceof Error ? error.message : "";
          if (!/model|permission|权限|无权|not found/i.test(detail)) throw error;
        }
      }
      if (lastError) throw lastError;
      setApiKey(""); setModel(savedModel);
      setMessage(savedModel === requestedModel
        ? `连接测试通过，${savedModel} 已保存并立即生效。`
        : `当前 Key 无法使用 ${requestedModel}，已自动改用并启用 ${savedModel}。`);
      await load(); window.dispatchEvent(new Event("model-config-changed"));
    }
    catch (error) { setMessage(`连接测试未通过，未保存配置：${error instanceof Error ? error.message : "未知错误"}`); }
    finally { setBusy(false); }
  }
  async function activate(item: ProviderConfig) {
    setWorkingId(item.id); setMessage("");
    try { await api.activateCloudProvider(item.id); setMessage(`已切换到 ${item.model}；之后启动的 Skill 将使用该模型。`); await load(); window.dispatchEvent(new Event("model-config-changed")); }
    catch (error) { setMessage(`切换失败：${error instanceof Error ? error.message : "未知错误"}`); }
    finally { setWorkingId(""); }
  }
  async function remove(item: ProviderConfig) {
    if (!window.confirm(`确定删除模型配置“${item.model}”吗？\n\nAPI Key 的加密记录也会一并删除。`)) return;
    setWorkingId(item.id); setMessage("");
    try { await api.deleteCloudProvider(item.id); setMessage(`已删除 ${item.model}。`); await load(); window.dispatchEvent(new Event("model-config-changed")); }
    catch (error) { setMessage(`删除失败：${error instanceof Error ? error.message : "未知错误"}`); }
    finally { setWorkingId(""); }
  }
  return <div className="model-settings-content">
    <span className="eyebrow">PERSONAL MODEL API</span><h2>模型与API配置</h2>
    <p className="panel-intro">保存前会发起一次最小连接测试；API Key只在服务器端使用，不返回浏览器，不写入运行日志。</p>
    <form onSubmit={save}>
      <label>模型平台与模型
        <select value={`${provider}::${model}`} onChange={(e) => chooseModel(e.target.value)}>
          {providers.flatMap((providerItem) => {
            const providerId = providerItem[0];
            const options = providerModels[providerId] || [];
            return options.map((item) => <option value={`${providerId}::${item}`} key={`${providerId}-${item}`}>{modelOptionLabel(item)}</option>);
          })}
        </select>
      </label>
      <label>接口 Base URL<input type="url" required value={baseUrl} readOnly={provider === "volcengine_agent_plan"} onChange={(e) => setBaseUrl(e.target.value)} placeholder="填写到 /v1 或厂商版本路径，不要包含 /chat/completions 或 /messages" /></label>
      <label>API Key<input type="password" required value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" placeholder="只用于服务器端加密保存"/></label>
      <p className="model-select-hint">选择模型后会自动匹配官方接口。用户只需填写所选平台对应的 API Key；Kimi 开放平台和 Kimi Code 的 Key 不通用。</p>
      {provider === "volcengine_agent_plan" && <p className="model-select-hint">请使用 Agent Plan 专属 API Key（不是普通火山方舟 Key）。工作台已锁定 OpenAI 兼容地址 `/api/plan/v3`，不需要手动修改。</p>}
      {provider === "anthropic" && <p className="model-select-hint">Claude 使用 Anthropic 原生 Messages API，请填写 Anthropic API Key，不要填写网页登录凭据。保存前会测试所选模型是否可用。</p>}
      {message && <p className="cloud-auth-message">{message}</p>}
      <button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin"/> : <Save/>}{busy ? "正在测试连接…" : "测试连接并保存"}</button>
    </form>
    <div className="cloud-provider-list"><div className="cloud-provider-list-heading"><div><h3>已配置模型</h3><p>切换时会重新测试连接；切换只影响之后启动的 Skill，运行中的任务继续使用启动时的模型。</p></div></div>{items.length ? items.map((item) => <div className={`cloud-provider-item${item.isDefault ? " active" : ""}`} key={item.id}>
      <div className="cloud-provider-identity"><span><strong>{item.provider}</strong> · {item.model}</span><code>{item.baseUrl}</code><small>密钥 {item.keyHint}</small></div>
      <div className="cloud-provider-actions">{item.isDefault ? <span className="cloud-provider-active"><CheckCircle2/>当前生效</span> : <button type="button" onClick={() => void activate(item)} disabled={Boolean(workingId)}>{workingId === item.id ? <LoaderCircle className="spin"/> : <Power/>}切换并启用</button>}<button type="button" className="danger" onClick={() => void remove(item)} disabled={Boolean(workingId) || item.isDefault} title={item.isDefault ? "请先切换到其他模型" : "删除模型配置"}><Trash2/>删除</button></div>
    </div>) : <p>尚未配置模型，运行 Skill 前请先填写。</p>}</div>
  </div>;
}

export function OcrSettingsContent() {
  const [config, setConfig] = useState<OcrConfig | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = () => api.cloudOcrConfig().then(setConfig).catch((error) => setMessage(error instanceof Error ? error.message : "读取 OCR 配置失败"));
  useEffect(() => { void load(); }, []);

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const result = await api.saveCloudOcrConfig(accessToken);
      setConfig(result.config); setAccessToken("");
      setMessage("PaddleOCR Token 已加密保存；之后上传的 PDF 将优先使用 PP-StructureV3 解析。");
    } catch (error) {
      setMessage(`保存失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm("确定删除当前账号的 PaddleOCR Token 吗？\n\n删除后，新上传的 PDF 将回退到本地基础解析。")) return;
    setBusy(true); setMessage("");
    try {
      await api.deleteCloudOcrConfig();
      await load(); setMessage("PaddleOCR Token 已删除，PDF 解析已回退到本地模式。");
    } catch (error) {
      setMessage(`删除失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally { setBusy(false); }
  }

  return <div className="model-settings-content ocr-settings-content">
    <span className="eyebrow">PERSONAL PDF OCR API</span><h2>PDF 解析与 OCR</h2>
    <p className="panel-intro">每个账号配置自己的百度 AI Studio PaddleOCR Token。Token 只在服务器端加密保存，不返回浏览器、不写入日志。</p>
    <div className="ocr-config-status">
      <div><strong>{config?.configured ? "PP-StructureV3 已启用" : "当前使用本地基础解析"}</strong><p>{config?.configured ? `已保存密钥 ${config.keyHint || ""}，新上传 PDF 会提交给百度解析。` : "未配置 Token 时使用 PDF.js/Tesseract，不会把 PDF 提交给百度。"}</p></div>
      <span className={config?.configured ? "ready" : "fallback"}>{config?.configured ? "已配置" : "未配置"}</span>
    </div>
    <form onSubmit={save}>
      <label>PaddleOCR Access Token<input type="password" required minLength={16} value={accessToken} onChange={(event) => setAccessToken(event.target.value)} autoComplete="off" placeholder={config?.configured ? "填写新 Token 可替换现有配置" : "从百度 AI Studio 复制 Access Token"}/></label>
      <p className="model-select-hint">配置后，PDF 文件会通过短时签名地址提交至百度 PP-StructureV3，相关调用额度与数据处理规则以百度账号为准。<a href="https://aistudio.baidu.com/account/accessToken" target="_blank" rel="noreferrer">打开 Token 页面</a></p>
      {message && <p className="cloud-auth-message">{message}</p>}
      <div className="cloud-provider-actions">
        <button className="button primary" disabled={busy || !accessToken.trim()}>{busy ? <LoaderCircle className="spin"/> : <Save/>}{config?.configured ? "替换并保存" : "加密保存并启用"}</button>
        {config?.configured && <button type="button" className="danger" onClick={() => void remove()} disabled={busy}><Trash2/>删除 Token</button>}
      </div>
    </form>
  </div>;
}

export function CloudGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(cloudMode);
  useEffect(() => {
    if (!cloudMode || !supabase) { setChecking(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setChecking(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const client = supabase;
    if (!cloudMode || !client || !session) return;
    let stopped = false;
    const verify = async () => {
      try { await api.session(); }
      catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!stopped && /登录|禁用|管理员已结束|账号资料/.test(message)) await client.auth.signOut();
      }
    };
    void verify();
    const timer = window.setInterval(() => void verify(), 15000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [session]);
  if (!cloudMode) return <>{children}</>;
  if (cloudConfigurationError) return <div className="cloud-config-error"><h1>在线服务暂不可用</h1><p>{cloudConfigurationError}</p><code>请联系管理员完成服务设置。</code></div>;
  if (checking) return <div className="cloud-loading"><LoaderCircle className="spin"/>正在检查登录状态…</div>;
  if (!session) return <AuthPanel/>;
  return <>{children}</>;
}

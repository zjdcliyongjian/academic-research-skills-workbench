import { useMemo, useState } from "react";
import { BookOpenText, Check, CircleDot, Download, Eye, FileText, Link2, LoaderCircle, RefreshCw, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { api } from "./api";
import { parseReadingContent } from "./readingView";
import type { ProjectDetail, ResearchProject, SourcePreview, SourceUploadItem } from "./types";

const processingLabels: Record<string, string> = {
  registered: "待处理", processing: "处理中", metadata_pending: "元数据待确认", metadata_verified: "元数据已核验",
  content_verified: "内容已核验", duplicate_candidate: "疑似重复", failed: "处理失败", rejected: "已拒绝",
};

function ReadingDocument({ content, title }: { content: string; title: string }) {
  const blocks = useMemo(() => parseReadingContent(content, title), [content, title]);
  return <article className="reading-document">
    {blocks.map((block, index) => {
      if (block.type === "page") return <div className="reading-page-marker" key={`page-${block.number}-${index}`}><span>第 {block.number} 页</span>{block.parser === "pp-structure-v3" ? <em>PP-StructureV3</em> : block.ocr && <em>OCR 识别</em>}</div>;
      if (block.type === "heading") return block.level === 2
        ? <h2 key={`heading-${index}`}>{block.text}</h2>
        : <h3 key={`heading-${index}`}>{block.text}</h3>;
      if (block.type === "paragraph") return <p key={`paragraph-${index}`}>{block.text}</p>;
      if (block.type === "list") {
        const items = block.items.map((item, itemIndex) => <li key={`${index}-${itemIndex}`}>{item}</li>);
        return block.ordered ? <ol key={`list-${index}`}>{items}</ol> : <ul key={`list-${index}`}>{items}</ul>;
      }
      const [header, ...rows] = block.rows;
      return <div className="reading-table-scroll" key={`table-${index}`}><table><thead><tr>{header.map((cell, cellIndex) => <th key={cellIndex}>{cell}</th>)}</tr></thead>{rows.length > 0 && <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>}</table></div>;
    })}
  </article>;
}

export function SourceWorkspace({ project, detail, busy, uploadItems, url, setUrl, onUpload, onRetryUpload, onAddUrl, onReload, onNotice }: {
  project: ResearchProject; detail: ProjectDetail | null; busy: string; uploadItems: SourceUploadItem[]; url: string; setUrl: (value: string) => void;
  onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void; onRetryUpload: (item: SourceUploadItem) => void; onAddUrl: () => void; onReload: () => Promise<void>; onNotice: (value: string) => void;
}) {
  const [sourceBusy, setSourceBusy] = useState("");
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [previewMode, setPreviewMode] = useState<"reading" | "raw">("reading");
  const process = async (sourceId: string) => {
    setSourceBusy(`process-${sourceId}`);
    try {
      const result = await api.processSource(project.id, sourceId);
      await onReload();
      setPreviewMode("reading");
      if (result.queued) {
        onNotice("资料处理任务已排队；PDF 抽取和 OCR 完成后会更新状态，请稍后刷新当前课题。 ");
        return;
      }
      setPreview(await api.previewSource(project.id, sourceId));
      const ocr = result.source.ocrUsed ? `已自动 OCR ${result.source.ocrPages} 页扫描内容；` : "";
      onNotice(result.duplicates.length ? `${ocr}正文已抽取，并发现 ${result.duplicates.length} 个疑似重复来源，请人工确认。` : `${ocr}正文与元数据候选已抽取；请核验后再作为来源事实使用。`);
    } catch (error) { await onReload(); onNotice((error as Error).message); }
    finally { setSourceBusy(""); }
  };
  const openPreview = async (sourceId: string) => {
    setSourceBusy(`preview-${sourceId}`);
    try { setPreviewMode("reading"); setPreview(await api.previewSource(project.id, sourceId)); }
    catch (error) { onNotice((error as Error).message); }
    finally { setSourceBusy(""); }
  };
  const verify = async (sourceId: string, scope: "metadata" | "content" | "reject", usePreviewMetadata = false) => {
    setSourceBusy(`${scope}-${sourceId}`);
    try {
      const metadata = usePreviewMetadata && preview?.source.id === sourceId ? { title: preview.source.title, authors: preview.source.authors, publicationYear: preview.source.publicationYear, venue: preview.source.venue, doi: preview.source.doi } : undefined;
      const result = await api.verifySource(project.id, sourceId, scope, "", metadata);
      if (preview?.source.id === sourceId) setPreview({ ...preview, source: result.source });
      await onReload(); onNotice(scope === "metadata" ? "元数据已保存并人工确认。" : scope === "content" ? "内容已人工确认，可用于来源事实。" : "该来源已拒绝，原始记录仍保留。");
    }
    catch (error) { onNotice((error as Error).message); }
    finally { setSourceBusy(""); }
  };
  const deleteSource = async (sourceId: string, label: string) => {
    if (!window.confirm(`确定从工作台删除来源“${label}”吗？\n\n工作台保存的原件、快照和抽取文件会移入项目回收站；被历史研究记录引用的来源不能删除。`)) return;
    setSourceBusy(`delete-source-${sourceId}`);
    try {
      await api.deleteSource(project.id, sourceId);
      if (preview?.source.id === sourceId) setPreview(null);
      await onReload(); onNotice("来源已从工作台移除，相关文件已转入项目回收站。");
    } catch (error) { onNotice((error as Error).message); }
    finally { setSourceBusy(""); }
  };
  const uploadedCount = uploadItems.filter((item) => item.status === "succeeded").length;
  const failedUploadCount = uploadItems.filter((item) => item.status === "failed").length;
  const finishedUploadCount = uploadedCount + failedUploadCount;
  const uploadStatusLabel: Record<SourceUploadItem["status"], string> = {
    queued: "等待上传", uploading: "上传中", succeeded: "上传成功 · 待处理", failed: "上传失败",
  };
  return <section className="workspace-section source-workspace">
    <div className="page-heading"><div><span className="eyebrow">SOURCE & EVIDENCE LEDGER · PHASE 2A</span><h1>可信资料与证据</h1><p>原件只读；自动抽取和元数据识别只是候选，经过人工核验后才能作为来源事实。</p><small className="supported-formats">支持批量选择 PDF、DOCX、Markdown、TXT 与 CSV，单文件最多 200MB；扫描版 PDF 会自动进行中英文 OCR。</small></div><label className={`button primary file-button ${busy === "upload" ? "is-disabled" : ""}`}>{busy === "upload" ? <LoaderCircle className="spin"/> : <Upload/>}{busy === "upload" ? `正在上传 ${finishedUploadCount}/${uploadItems.length}` : "批量上传资料"}<input type="file" multiple disabled={busy === "upload"} accept=".pdf,.docx,.md,.txt,.csv" onChange={onUpload}/></label></div>
    {uploadItems.length > 0 && <section className="upload-batch" aria-live="polite">
      <div className="upload-batch-head"><div><strong>本批上传</strong><span>{uploadedCount} 成功{failedUploadCount ? ` · ${failedUploadCount} 失败` : ""} · 共 {uploadItems.length} 个文件</span></div>{busy === "upload" && <span>同时上传最多 3 个文件</span>}</div>
      <div className="upload-batch-list">{uploadItems.map((item) => <div key={item.id} className={`upload-batch-item ${item.status}`}>
        <span className="upload-state-icon">{item.status === "uploading" ? <LoaderCircle className="spin"/> : item.status === "succeeded" ? <Check/> : item.status === "failed" ? <X/> : <CircleDot/>}</span>
        <div><strong>{item.name}</strong><small>{(item.size / 1024 / 1024).toFixed(item.size >= 1024 * 1024 ? 1 : 2)} MB{item.error ? ` · ${item.error}` : ""}</small></div>
        <div className="upload-item-state"><span>{uploadStatusLabel[item.status]}</span>{item.status === "failed" && <button type="button" onClick={() => onRetryUpload(item)} disabled={busy === "upload"}><RefreshCw/>重新上传</button>}</div>
      </div>)}</div>
    </section>}
    <div className="url-row"><Link2/><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="粘贴公开论文、数据集或机构网页地址"/><button onClick={onAddUrl} disabled={!url || busy === "url"}>登记地址</button></div>
    <div className="source-evidence-layout">
      <div className="source-list rich-source-list">{detail?.sources.length ? detail.sources.map((source) => <article key={source.id} className={preview?.source.id === source.id ? "active" : ""}>
        <div className="source-icon">{source.kind === "url" ? <Link2/> : <FileText/>}</div>
        <div className="source-main"><strong>{source.title || source.name}</strong><p>{source.relativePath || source.url}</p><div className="source-metadata">{source.doi && <span>DOI {source.doi}</span>}{source.publicationYear && <span>{source.publicationYear}</span>}{source.mimeType && <span>{source.mimeType}</span>}{source.ocrUsed && <span>OCR {source.ocrPages} 页</span>}</div>{source.failureReason && <small className="source-error">{source.failureReason}</small>}</div>
        <span className={`evidence-state ${source.processingStatus}`}>{processingLabels[source.processingStatus] || source.processingStatus}</span>
        <div className="source-actions">
          <button onClick={() => process(source.id)} disabled={sourceBusy === `process-${source.id}`}>{sourceBusy === `process-${source.id}` ? <LoaderCircle className="spin"/> : <RefreshCw/>}{source.processedAt ? "重新处理" : "处理"}</button>
          {source.extractedPath && <button onClick={() => openPreview(source.id)} disabled={sourceBusy === `preview-${source.id}`}><Eye/>预览</button>}
          {(source.kind === "file" || source.snapshotPath) && <button className="source-download" onClick={() => api.downloadSource(project.id, source.id, source.kind === "file" ? "original" : "snapshot", source.name).catch((e) => onNotice(e.message))}><Download/>{source.kind === "file" ? "下载原件" : "下载快照"}</button>}
          {source.extractedPath && <button className="source-download" onClick={() => api.downloadSource(project.id, source.id, "extracted", `${source.title || source.name}.txt`).catch((e) => onNotice(e.message))}><Download/>抽取文本</button>}
          {source.processingStatus === "metadata_pending" && <button onClick={() => verify(source.id, "metadata")}><Check/>确认元数据</button>}
          {source.status === "metadata-verified" && <button onClick={() => verify(source.id, "content")}><ShieldCheck/>确认内容</button>}
          <button className="danger-action" onClick={() => deleteSource(source.id, source.title || source.name)} disabled={sourceBusy === `delete-source-${source.id}`}><Trash2/>删除</button>
        </div>
      </article>) : <div className="empty"><CircleDot/><h3>资料台账为空</h3><p>上传文档或登记公开网页，开始建立可追溯证据。</p></div>}</div>
      <aside className="source-preview">{preview ? <>
        <div className="preview-head"><div><span className="eyebrow">EXTRACTED READING VIEW</span><h3>{preview.source.title || preview.source.name}</h3><p>{preview.note}</p></div><button className="icon-button" onClick={() => setPreview(null)} aria-label="关闭正文预览"><X/></button></div>
        <div className="preview-purpose"><BookOpenText/><div><strong>这份抽取正文有什么用？</strong><p>用于全文检索、定位证据、生成研究路线和模型分析。确认前它只是候选内容，不会自动成为来源事实；公式、表格、图片及 OCR 结果仍需对照原件。</p></div></div>
        <div className="metadata-editor">
          <label className="metadata-title">题名<input value={preview.source.title || ""} onChange={(event) => setPreview({ ...preview, source: { ...preview.source, title: event.target.value } })}/></label>
          <label>DOI<input value={preview.source.doi || ""} onChange={(event) => setPreview({ ...preview, source: { ...preview.source, doi: event.target.value } })}/></label>
          <label>年份<input type="number" value={preview.source.publicationYear || ""} onChange={(event) => setPreview({ ...preview, source: { ...preview.source, publicationYear: Number(event.target.value) || null } })}/></label>
          <label className="metadata-authors">作者（用分号分隔）<input value={preview.source.authors.join("; ")} onChange={(event) => setPreview({ ...preview, source: { ...preview.source, authors: event.target.value.split(/[;；]/).map((item) => item.trim()).filter(Boolean) } })}/></label>
          <button className="button secondary small" onClick={() => verify(preview.source.id, "metadata", true)}><Check/>保存并确认元数据</button>
        </div>
        <div className="reading-toolbar"><div className="reading-mode-switch"><button className={previewMode === "reading" ? "active" : ""} onClick={() => setPreviewMode("reading")}><BookOpenText/>排版阅读</button><button className={previewMode === "raw" ? "active" : ""} onClick={() => setPreviewMode("raw")}><FileText/>原始文本</button></div><span>{preview.content.replace(/\s/g, "").length.toLocaleString("zh-CN")} 字</span></div>
        <div className={`source-preview-paper ${previewMode === "raw" ? "is-raw" : "is-reading"}`}>{previewMode === "reading" ? <ReadingDocument content={preview.content} title={preview.source.title || preview.source.name}/> : <pre>{preview.content}</pre>}</div>
      </> : <div className="preview-placeholder"><Eye/><span className="eyebrow">EVIDENCE READING DESK</span><h3>处理来源后在这里核对正文</h3><p>PDF 会保留页码标记；扫描页会自动 OCR，但公式、表格、图片和识别结果仍需对照原件。</p></div>}</aside>
    </div>
  </section>;
}

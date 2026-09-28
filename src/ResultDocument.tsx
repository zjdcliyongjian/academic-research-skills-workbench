import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X } from "lucide-react";

export function ResultDocument({ content }: { content: string }) {
  return <article className="result-document"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></article>;
}

export function ResultPreview({ title, content, onClose }: { title: string; content: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="result-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }} aria-label={title}>
    <header><div><span className="eyebrow">RESEARCH READING VIEW</span><h2>{title}</h2><p>只读预览，不改变审阅或采用状态。</p></div><button autoFocus className="icon-button" aria-label="关闭预览" onClick={onClose}><X/></button></header>
    <div className="result-dialog-body"><ResultDocument content={content || "暂无正文内容。"}/></div>
  </dialog>;
}

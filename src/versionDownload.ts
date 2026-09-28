export function markdownFileName(label: string, kind: string, id: string) {
  const safe = (value: string) => value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").trim().slice(0, 80);
  return `${safe(label)}-${safe(kind)}-${safe(id)}.md`;
}

export function downloadMarkdown(content: string, filename: string) {
  if (!content.trim()) throw new Error("该版本暂无可导出的正文。");
  const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try { link.click(); }
  finally {
    link.remove();
    // Allow the browser to begin consuming the download before revoking it.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

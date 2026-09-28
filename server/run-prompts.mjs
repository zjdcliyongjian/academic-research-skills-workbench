export const RETRY_NOTE = "这是一次重新运行。请重新检查证据边界，并输出完整结果。";

export function buildRetryPrompt(prompt) {
  let base = String(prompt).trimEnd();
  const suffix = `---\n${RETRY_NOTE}`;
  while (base.endsWith(suffix)) {
    base = base.slice(0, -suffix.length).trimEnd();
  }
  return `${base}\n\n---\n${RETRY_NOTE}`;
}

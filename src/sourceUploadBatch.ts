import type { SourceUploadItem } from "./types";

export interface PreparedSourceUploadBatch {
  files: File[];
  items: SourceUploadItem[];
  skippedDuplicates: number;
}

function fileIdentity(file: File) {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

function uploadId(index: number, file: File) {
  const randomId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${randomId}-${index}-${file.name}`;
}

export function prepareSourceUploadBatch(input: Iterable<File>): PreparedSourceUploadBatch {
  const seen = new Set<string>();
  const files: File[] = [];
  let skippedDuplicates = 0;
  for (const file of input) {
    const identity = fileIdentity(file);
    if (seen.has(identity)) {
      skippedDuplicates += 1;
      continue;
    }
    seen.add(identity);
    files.push(file);
  }
  return {
    files,
    skippedDuplicates,
    items: files.map((file, index) => ({ id: uploadId(index, file), file, name: file.name, size: file.size, status: "queued", error: null })),
  };
}

export async function retrySourceUploadItem(
  item: SourceUploadItem,
  upload: (file: File) => Promise<unknown>,
  onChange: (item: SourceUploadItem) => void,
) {
  let nextItem: SourceUploadItem = { ...item, status: "uploading", error: null };
  onChange(nextItem);
  try {
    await upload(item.file);
    nextItem = { ...nextItem, status: "succeeded", error: null };
  } catch (error) {
    nextItem = { ...nextItem, status: "failed", error: error instanceof Error ? error.message : "文件上传失败" };
  }
  onChange(nextItem);
  return nextItem;
}

export async function runSourceUploadBatch(
  batch: PreparedSourceUploadBatch,
  upload: (file: File) => Promise<unknown>,
  onChange: (items: SourceUploadItem[]) => void,
  concurrency = 3,
) {
  let items = batch.items.map((item) => ({ ...item }));
  const update = (index: number, patch: Partial<SourceUploadItem>) => {
    items = items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item);
    onChange(items.map((item) => ({ ...item })));
  };
  onChange(items.map((item) => ({ ...item })));

  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= batch.files.length) return;
      update(index, { status: "uploading", error: null });
      try {
        await upload(batch.files[index]);
        update(index, { status: "succeeded", error: null });
      } catch (error) {
        update(index, { status: "failed", error: error instanceof Error ? error.message : "文件上传失败" });
      }
    }
  };

  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), batch.files.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return items;
}

import { describe, expect, it } from "vitest";
import { prepareSourceUploadBatch, retrySourceUploadItem, runSourceUploadBatch } from "../src/sourceUploadBatch";

function file(name: string, size = 8, lastModified = 1) {
  return new File([new Uint8Array(size)], name, { lastModified, type: "application/pdf" });
}

describe("source upload batch", () => {
  it("deduplicates the same file selection and preserves distinct files", () => {
    const first = file("paper-a.pdf", 8, 1);
    const duplicate = file("paper-a.pdf", 8, 1);
    const second = file("paper-b.pdf", 8, 2);
    const batch = prepareSourceUploadBatch([first, duplicate, second]);
    expect(batch.files.map((item) => item.name)).toEqual(["paper-a.pdf", "paper-b.pdf"]);
    expect(batch.skippedDuplicates).toBe(1);
    expect(batch.items.every((item) => item.status === "queued")).toBe(true);
    expect(batch.items[0].file).toBe(first);
  });

  it("limits concurrency and keeps other uploads running after one failure", async () => {
    const batch = prepareSourceUploadBatch([file("a.pdf"), file("bad.pdf"), file("c.pdf"), file("d.pdf")]);
    let active = 0;
    let maxActive = 0;
    const snapshots: string[][] = [];
    const result = await runSourceUploadBatch(batch, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (item.name === "bad.pdf") throw new Error("模拟上传失败");
    }, (items) => snapshots.push(items.map((item) => item.status)), 2);

    expect(maxActive).toBe(2);
    expect(result.map((item) => item.status)).toEqual(["succeeded", "failed", "succeeded", "succeeded"]);
    expect(result[1].error).toBe("模拟上传失败");
    expect(snapshots.some((snapshot) => snapshot.includes("uploading"))).toBe(true);
  });

  it("retries one failed item with the original file and reports each state", async () => {
    const original = file("retry.pdf", 12, 3);
    const failedItem = { ...prepareSourceUploadBatch([original]).items[0], status: "failed" as const, error: "操作过于频繁，请稍后再试" };
    const states: string[] = [];
    let received: File | null = null;

    const result = await retrySourceUploadItem(failedItem, async (item) => { received = item; }, (item) => states.push(item.status));

    expect(received).toBe(original);
    expect(states).toEqual(["uploading", "succeeded"]);
    expect(result.status).toBe("succeeded");
    expect(result.error).toBeNull();
  });

  it("keeps a retried item failed when the new upload also fails", async () => {
    const failedItem = { ...prepareSourceUploadBatch([file("retry.pdf")]).items[0], status: "failed" as const, error: "首次失败" };

    const result = await retrySourceUploadItem(failedItem, async () => { throw new Error("仍然过于频繁"); }, () => undefined);

    expect(result.status).toBe("failed");
    expect(result.error).toBe("仍然过于频繁");
  });
});

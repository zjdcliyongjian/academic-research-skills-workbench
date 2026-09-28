import { describe, expect, it } from "vitest";
import { createSourceUploadTarget, MAX_SOURCE_FILE_BYTES, validateSourceUpload } from "../cloud/source-upload.mjs";

describe("cloud source upload validation", () => {
  it("accepts supported files up to 200 MB", () => {
    expect(validateSourceUpload({ name: "scan.pdf", size: MAX_SOURCE_FILE_BYTES, mimeType: "application/pdf" }).size).toBe(MAX_SOURCE_FILE_BYTES);
  });

  it("rejects oversized and unsupported files", () => {
    expect(() => validateSourceUpload({ name: "scan.pdf", size: MAX_SOURCE_FILE_BYTES + 1 })).toThrow(/200MB/);
    expect(() => validateSourceUpload({ name: "archive.exe", size: 100 })).toThrow(/仅支持/);
  });

  it("creates an owner-scoped private path", () => {
    const target = createSourceUploadTarget("owner", "project", { name: "paper.pdf", size: 8 });
    expect(target.path).toBe(`owner/project/sources/${target.sourceId}/${target.sourceId}.pdf`);
  });

  it("keeps Unicode display names out of the storage key", () => {
    const target = createSourceUploadTarget("owner", "project", { name: "研究方案与实验设计.docx", size: 8 });
    expect(target.name).toBe("研究方案与实验设计.docx");
    expect(target.path).toMatch(/^owner\/project\/sources\/[0-9a-f-]+\/[0-9a-f-]+\.docx$/);
    expect(target.path).not.toMatch(/[研究方案实验设计]/);
  });
});

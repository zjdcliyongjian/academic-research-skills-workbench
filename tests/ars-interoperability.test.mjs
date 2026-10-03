import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { importSchema9Passport, readImportedSchema9Passport } from "../server/ars-interoperability.mjs";

describe("Schema 9 interoperability boundary", () => {
  test("keeps the imported bytes and validates the supported core subset", async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), "ars-schema9-"));
    const project = { projectPath };
    const content = JSON.stringify({
      origin_skill: "academic-paper",
      origin_mode: "full",
      origin_date: "2026-09-28T08:00:00Z",
      verification_status: "UNVERIFIED",
      version_label: "paper_draft_v1",
      repro_lock: null,
    }, null, 2);
    const report = await importSchema9Passport(project, { fileName: "passport.json", content });
    expect(report.status).toBe("validated_subset");
    expect(report.errors).toEqual([]);
    expect(report.checks.repro_lock.status).toBe("passed");
    const imported = await readImportedSchema9Passport(project);
    expect(imported.buffer.toString("utf8")).toBe(content);
  });

  test("isolates an invalid import without calling it compatible", async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), "ars-schema9-invalid-"));
    const report = await importSchema9Passport({ projectPath }, { fileName: "bad.json", content: JSON.stringify({ verification_status: "PASS" }) });
    expect(report.status).toBe("invalid");
    expect(report.errors.some((item) => item.includes("origin_skill"))).toBe(true);
    expect(await readFile(path.join(projectPath, report.imported_relative_path), "utf8")).toContain("PASS");
  });
});

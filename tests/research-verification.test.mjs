import { execFile } from "node:child_process";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { runLedgerRuntime } from "../server/ars-ledger.mjs";
import {
  readVerificationStatus,
  runPdfPreflight,
  runProgrammaticCitationVerification,
  VERIFICATION_AUTHORIZATION_TEXT,
} from "../server/research-verification.mjs";

const execFileAsync = promisify(execFile);

describe("research verification safety gates", () => {
  test("starts with an empty local cache and no inferred verification", async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), "ars-verification-"));
    const status = await readVerificationStatus({ projectPath });
    expect(status.pdfPreflights).toEqual([]);
    expect(status.cache.status).toBe("empty");
    expect(status.cache.rows).toBe(0);
    expect(status.latestProgrammatic).toBeNull();
    expect(status.authorizationText).toBe(VERIFICATION_AUTHORIZATION_TEXT);
  });

  test("refuses programmatic bibliographic calls without the exact per-run authorization", async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), "ars-verification-auth-"));
    await expect(runProgrammaticCitationVerification({ projectPath }, {
      authorized: true,
      authorizationText: "我同意核验",
      revalidateStale: false,
    })).rejects.toMatchObject({ status: 403 });
  });

  test("refuses page-anchor preflight for a non-PDF source", async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), "ars-verification-pdf-"));
    await expect(runPdfPreflight({ projectPath }, { id: "S1", relativePath: "02-sources/original/note.txt" }))
      .rejects.toThrow("只支持项目内已登记的 PDF 原件");
  });

  test("runs the upstream structural preflight and persists its sidecar", async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), "ars-verification-valid-pdf-"));
    const relativePath = "02-sources/original/sample.pdf";
    const target = path.join(projectPath, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    const runtime = runLedgerRuntime();
    await execFileAsync(runtime.python, ["-c", "from pypdf import PdfWriter; import sys; w=PdfWriter(); w.add_blank_page(width=612,height=792); w.write(sys.argv[1])", target], {
      env: { ...process.env, PYTHONPATH: runtime.dependencyPath },
      windowsHide: true,
    });
    const result = await runPdfPreflight({ projectPath }, { id: "S-PDF", relativePath, title: "结构测试 PDF", name: "sample.pdf" });
    expect(result.verdict).toBe("PASS");
    expect(result.sidecarPath).toContain("10-passport/verification/pdf-preflight/");
    const status = await readVerificationStatus({ projectPath });
    expect(status.pdfPreflights).toHaveLength(1);
    expect(status.pdfPreflights[0].contentSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

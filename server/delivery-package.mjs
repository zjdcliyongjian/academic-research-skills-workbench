import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { assertInside, safeSegment } from "./vault.mjs";

async function collectFormalExports(project) {
  const root = path.join(project.projectPath, "11-exports");
  const files = [];
  async function walk(directory) {
    let entries = [];
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "package") await walk(fullPath);
      } else if (entry.isFile() && /(?:^|[-_.])FORMAL(?:[-_.]|$)/i.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  await walk(root);
  return files;
}

export async function exportDeliveryPackage(project, sources, versions) {
  const activeVersions = versions.filter((item) => item.status === "active");
  if (!activeVersions.length) throw new Error("尚无人工采用的正式版本，不能生成交付包");
  const zip = new JSZip();
  const generatedAt = new Date().toISOString();
  const verifiedSources = sources.filter((item) => ["metadata-verified", "content-verified"].includes(item.status));
  const manifest = {
    schemaVersion: 1,
    generatedAt,
    project: { id: project.id, name: project.name, field: project.field, goal: project.goal, language: project.language, paperType: project.paperType, stage: project.stage },
    versions: activeVersions.map((item) => ({ id: item.id, stage: item.stage, versionNumber: item.versionNumber, runId: item.runId, skillName: item.skillName, relativePath: item.relativePath, contentSha256: item.contentSha256, adoptedAt: item.adoptedAt })),
    verifiedSources: verifiedSources.map((item) => ({ id: item.id, title: item.title, authors: item.authors, publicationYear: item.publicationYear, venue: item.venue, doi: item.doi, url: item.url, sha256: item.sha256, status: item.status })),
    limitations: [
      "交付包只包含人工采用的当前正式版本和已核验来源元数据。",
      "原始文献、未采用草稿和项目内部运行日志默认不打包，避免误传与隐私泄露。",
      "引用、实验数据、作者信息、版权和投稿格式仍需作者最终核验。",
    ],
  };
  zip.file("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  zip.file("README.md", `# ${project.name}｜科研交付包\n\n生成时间：${generatedAt}\n\n本交付包由 AI 科研工作台整理，只包含人工采用的当前正式版本与已核验来源元数据。原始文献、未采用草稿和内部运行日志未包含。正式投稿前，请作者核验引用、实验数据、作者信息、版权与目标期刊格式。\n`);
  for (const version of activeVersions) {
    const target = assertInside(project.projectPath, path.join(project.projectPath, version.relativePath));
    zip.file(`versions/${version.stage}-v${String(version.versionNumber).padStart(3, "0")}.md`, await readFile(target));
  }
  for (const file of await collectFormalExports(project)) {
    const info = await stat(file);
    if (info.size <= 25 * 1024 * 1024) zip.file(`exports/${path.basename(file)}`, await readFile(file));
  }
  const target = assertInside(project.projectPath, path.join(project.projectPath, "11-exports", "package", `${safeSegment(project.name)}-DELIVERY-${Date.now()}.zip`));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
  return target;
}

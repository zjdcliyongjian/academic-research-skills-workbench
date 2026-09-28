import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, keyHint } from "../cloud/crypto.mjs";
import { appendConversationTurn, buildCloudPrompt, CLOUD_SKILLS, currentRunMessage, getSkill } from "../cloud/skills.mjs";

describe("cloud BYOK encryption", () => {
  const original = process.env.BYOK_MASTER_KEY;
  beforeEach(() => { process.env.BYOK_MASTER_KEY = randomBytes(32).toString("base64"); });
  afterEach(() => { if (original === undefined) delete process.env.BYOK_MASTER_KEY; else process.env.BYOK_MASTER_KEY = original; });

  it("round trips a provider key without storing it as plaintext", () => {
    const secret = "demo-secret-123456789";
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
    expect(keyHint(secret)).toBe("dem••••6789");
  });

  it("rejects an invalid master key", () => {
    process.env.BYOK_MASTER_KEY = "bad";
    expect(() => encryptSecret("sk-valid-length-key")).toThrow(/密钥加密服务配置无效/);
  });
});

describe("cloud research skill contract", () => {
  it("exposes all twelve reviewed skills", () => {
    expect(CLOUD_SKILLS).toHaveLength(12);
    expect(getSkill("pre-submission-reviewer").stage).toBe("review");
  });

  it("only promotes verified source facts into the prompt", () => {
    const prompt = buildCloudPrompt({
      project: { name: "测试课题", field: "计算机视觉", paper_type: "technical", language: "zh", goal: "验证方法", stage: "research" },
      skillName: "deep-research",
      input: { instructions: "比较两种方法" },
      sources: [
        { status: "content-verified", title: "已核验论文", name: "a.pdf", extracted_text: "真实正文", url: "https://example.com/a" },
        { status: "raw", title: "未核验论文", name: "b.pdf", extracted_text: "不应进入上下文", url: "https://example.com/b" },
      ],
      evidenceClaims: [
        { claimType: "source_fact", verificationStatus: "verified", claim_text: "已核验事实" },
        { claimType: "source_fact", verificationStatus: "pending", claim_text: "待核验事实" },
      ],
      versions: [],
    });
    expect(prompt.user).toContain("已核验论文");
    expect(prompt.user).not.toContain("未核验论文");
    expect(prompt.user).toContain("已核验事实");
    expect(prompt.user).not.toContain("待核验事实");
    expect(prompt.system).toContain("不得虚构实验");
  });

  it("keeps the current user message and prior turns in a bounded follow-up context", () => {
    const input = appendConversationTurn({ instructions: "起草引言" }, { prompt: "起草引言", output: "第一版引言" }, "把研究缺口写具体");
    expect(currentRunMessage("intro-drafter", input)).toBe("把研究缺口写具体");
    const prompt = buildCloudPrompt({
      project: { name: "测试课题", field: "材料", paper_type: "technical", language: "zh", goal: "起草论文", stage: "writing" },
      skillName: "intro-drafter", input, sources: [], evidenceClaims: [], versions: [],
    });
    expect(prompt.user).toContain("已保存的多轮对话");
    expect(prompt.user).toContain("第一版引言");
    expect(prompt.user).toContain("本轮用户要求：\n把研究缺口写具体");
  });
});

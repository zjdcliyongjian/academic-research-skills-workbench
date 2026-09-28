import { describe, expect, it } from "vitest";
import { normalizeTrialAccount, trialLoginEmail, validateTrialPassword } from "../cloud/auth-trial.mjs";

describe("trial authentication rules", () => {
  it("accepts normalized email and mainland phone identifiers", () => {
    expect(normalizeTrialAccount(" Researcher@Example.COM ")).toBe("researcher@example.com");
    expect(normalizeTrialAccount("+86 138-0013-8000")).toBe("13800138000");
    expect(() => normalizeTrialAccount("lab2026a")).toThrow(/手机号或邮箱/);
  });

  it("requires 8-12 password characters with all required categories", () => {
    expect(validateTrialPassword("Lab2026@")).toBe("Lab2026@");
    expect(validateTrialPassword("Abcdef12#xyz")).toBe("Abcdef12#xyz");
    expect(() => validateTrialPassword("Abcdef12")).toThrow(/特殊字符/);
    expect(() => validateTrialPassword("Abcdefgh12345@")).toThrow(/长度上限/);
  });

  it("creates deterministic login ids without exposing the account", () => {
    const login = trialLoginEmail("researcher@example.com");
    expect(login).toMatch(/^trial-[a-f0-9]{40}@research-copilot\.local$/);
    expect(login).toBe(trialLoginEmail("researcher@example.com"));
    expect(login).not.toContain("researcher");
  });
});

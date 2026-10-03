import { describe, expect, it } from "vitest";
import { passwordRuleError, resolveAuthIdentity, trialLoginEmail } from "./authValidation";

describe("resolveAuthIdentity", () => {
  it("accepts and normalizes email accounts", () => {
    expect(resolveAuthIdentity(" Researcher@Example.COM ")).toMatchObject({ kind: "email", email: "researcher@example.com" });
  });

  it("accepts mainland phone accounts with or without the country code", () => {
    expect(resolveAuthIdentity("13800138000")).toMatchObject({ kind: "phone", phone: "+8613800138000" });
    expect(resolveAuthIdentity("+86 138-0013-8000")).toMatchObject({ kind: "phone", phone: "+8613800138000" });
  });

  it("accepts usernames and preserves the reserved admin account", () => {
    expect(resolveAuthIdentity("admin")).toMatchObject({ kind: "admin", email: "admin@research-copilot.local" });
    expect(resolveAuthIdentity("Lab2026_A")).toMatchObject({ kind: "username", account: "lab2026_a" });
    expect(resolveAuthIdentity("研究员-01")).toMatchObject({ kind: "username", account: "研究员-01" });
    expect(resolveAuthIdentity("ab")).toBeNull();
  });
});

describe("passwordRuleError", () => {
  it("accepts 8 to 12 characters with letters, numbers and special characters", () => {
    expect(passwordRuleError("Lab2026@")).toBe("");
    expect(passwordRuleError("Abcdef12#xyz")).toBe("");
  });

  it("rejects invalid length, missing categories and whitespace", () => {
    expect(passwordRuleError("Ab12@")).not.toBe("");
    expect(passwordRuleError("Abcdefgh12345@")).not.toBe("");
    expect(passwordRuleError("abcdefgh@")).not.toBe("");
    expect(passwordRuleError("12345678@")).not.toBe("");
    expect(passwordRuleError("Abcdef12")).not.toBe("");
    expect(passwordRuleError("Abcd 12@")).not.toBe("");
  });
});

describe("trialLoginEmail", () => {
  it("derives a stable internal login email without exposing the account", async () => {
    const identity = resolveAuthIdentity("researcher@example.com");
    expect(identity).not.toBeNull();
    const email = await trialLoginEmail(identity!);
    expect(email).toMatch(/^trial-[a-f0-9]{40}@research-copilot\.local$/);
    expect(email).not.toContain("researcher");
  });
});

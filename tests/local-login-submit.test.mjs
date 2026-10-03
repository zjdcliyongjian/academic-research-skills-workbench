import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/cloud/CloudGate.tsx", import.meta.url), "utf8");

describe("local login form submission", () => {
  it("does not stop local submission when Supabase is absent", () => {
    expect(source).not.toMatch(/if\s*\(\s*!supabase\s*\)\s*return\s*;/);
    expect(source).toContain("if (!register) await api.localLogin");
    expect(source).toContain("if (register) await api.trialRegister");
  });

  it("exposes submission feedback to assistive technology", () => {
    expect(source).toContain('role="status" aria-live="polite"');
    expect(source).toContain('type="submit" className="cloud-auth-submit"');
  });
});

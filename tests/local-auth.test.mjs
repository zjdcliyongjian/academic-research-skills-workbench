import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.AI_RESEARCH_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "ars-local-auth-"));
const auth = await import("../server/local-auth.mjs");

describe("local workbench authentication", () => {
  it("registers a username, creates a session and supports later login", () => {
    const registered = auth.registerLocalAccount("Researcher_01", "Lab2026@");
    expect(registered.user).toMatchObject({ username: "researcher_01", role: "user", status: "active" });
    const request = { headers: { cookie: `ars_local_session=${registered.token}` } };
    expect(auth.localSession(request)).toMatchObject({ username: "researcher_01" });
    expect(auth.loginLocalAccount("researcher_01", "Lab2026@").user.username).toBe("researcher_01");
  });

  it("accepts email and mainland phone identifiers without requiring verification", () => {
    expect(auth.registerLocalAccount(" Researcher@Example.COM ", "Lab2026@").user.username).toBe("researcher@example.com");
    expect(auth.loginLocalAccount("researcher@example.com", "Lab2026@").user.username).toBe("researcher@example.com");
    expect(auth.registerLocalAccount("+86 138-0013-8000", "Lab2026@").user.username).toBe("13800138000");
  });

  it("rejects duplicate accounts, invalid passwords and the reserved admin name", () => {
    expect(() => auth.registerLocalAccount("Researcher_01", "Lab2026@")).toThrow(/已注册/);
    expect(() => auth.loginLocalAccount("researcher_01", "wrong-pass")).toThrow(/密码必须/);
    expect(() => auth.registerLocalAccount("admin", "Lab2026@")).toThrow(/保留管理员账号/);
  });

  it("invalidates the current session on logout", () => {
    const login = auth.loginLocalAccount("researcher_01", "Lab2026@");
    const request = { headers: { cookie: `ars_local_session=${login.token}` } };
    expect(auth.localSession(request)).not.toBeNull();
    auth.logoutLocalSession(request);
    expect(auth.localSession(request)).toBeNull();
  });
});

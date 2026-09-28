import { describe, expect, it } from "vitest";
import { initialOnboardingStep } from "./onboarding";

describe("first-login onboarding", () => {
  it("guides an account without an active model to configure one", () => {
    expect(initialOnboardingStep(false, false)).toBe("model");
  });

  it("does not interrupt an account that already has an active model", () => {
    expect(initialOnboardingStep(true, false)).toBeNull();
  });

  it("does not repeat the guide after the user skips it", () => {
    expect(initialOnboardingStep(false, true)).toBeNull();
  });
});

export type OnboardingStep = "checking" | "model" | null;

export function initialOnboardingStep(modelConfigured: boolean, skipped: boolean): OnboardingStep {
  return modelConfigured || skipped ? null : "model";
}

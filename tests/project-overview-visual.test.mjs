import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("project overview visual hierarchy", () => {
  it("does not repeat the full research goal in the overview hero", () => {
    const overviewHero = app.match(/<section className="hero ars-hero">[\s\S]*?<\/section>/)?.[0] || "";
    expect(overviewHero).not.toContain("selected.goal");
    expect(overviewHero).toContain("selected.name");
  });

  it("uses a dedicated high-contrast passport surface in the cosmic workbench", () => {
    expect(styles).toContain(".cosmic-workbench .passport-panel{");
    expect(styles).toContain(".cosmic-workbench .passport-copy h2{");
    expect(styles).toContain(".cosmic-workbench .passport-stats div{");
  });
});

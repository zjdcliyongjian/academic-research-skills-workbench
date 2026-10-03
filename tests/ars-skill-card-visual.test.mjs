import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("ARS capability cards in the cosmic workbench", () => {
  it("uses a dark high-contrast surface instead of the editorial ivory card", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(css).toContain(".cosmic-workbench .skill-card{background:linear-gradient(145deg,rgba(9,31,72,.96),rgba(4,18,50,.98))");
    expect(css).toContain(".cosmic-workbench .skill-card h3,.cosmic-workbench .skill-card .skill-contract dd{color:#f4f8ff}");
    expect(css).toContain(".cosmic-workbench .skill-card .skill-description");
  });
});

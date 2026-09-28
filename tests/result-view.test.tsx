import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ResultDocument } from "../src/ResultDocument";
import { taskExamples } from "../src/taskGuidance";

describe("research result reading", () => {
  it("renders headings, emphasis, lists and GFM tables", () => {
    const html = renderToStaticMarkup(<ResultDocument content={'## 研究问题\n\n**重要**\n\n- 待验证\n\n| 方法 | 结果 |\n| --- | --- |\n| A | 待实验 |'}/>);
    expect(html).toContain('<h2>研究问题</h2>');
    expect(html).toContain('<strong>重要</strong>');
    expect(html).toContain('<li>待验证</li>');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>待实验</td>');
  });
  it("does not execute embedded HTML or unsafe links", () => {
    const html = renderToStaticMarkup(<ResultDocument content={'<script>alert(1)</script>\n\n[bad](javascript:alert(1))'}/>);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
  });
  it("supplies distinct examples for all twelve tasks", () => {
    expect(Object.keys(taskExamples)).toHaveLength(12);
    expect(new Set(Object.values(taskExamples)).size).toBe(12);
    expect(taskExamples['intro-drafter']).toContain('引言');
    expect(taskExamples['tech-paper-template']).toContain('目录');
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactBlogger, ContactDialog, contactCards } from "../src/cloud/ContactBlogger";

describe("login blogger contact", () => {
  it("keeps the requested platform order", () => {
    expect(contactCards.map(card => card.label)).toEqual(["微信", "小红书", "抖音", "视频号", "B站"]);
    expect(new Set(contactCards.map(card => card.image)).size).toBe(5);
  });
  it("does not submit the login form when opening contact", () => {
    expect(renderToStaticMarkup(<ContactBlogger/>)).toContain('type="button"');
  });
  it("uses sidebar menu styling without the login button colors", () => {
    const html = renderToStaticMarkup(<ContactBlogger variant="sidebar"/>);
    expect(html).toContain('class="contact-sidebar-trigger"');
    expect(html).not.toContain('class="contact-blogger-trigger"');
    expect(html).toContain('<span>联系博主</span>');
    expect(html).toContain('type="button"');
  });
  it("includes five uncropped image sources and the exact contact details", () => {
    const html = renderToStaticMarkup(<ContactDialog onClose={() => {}}/>);
    expect(html.match(/<img /g)).toHaveLength(5);
    expect(html).toContain("zzshare147");
    expect(html).toContain('href="mailto:1209655870@qq.com"');
    expect(html).toContain("关闭联系博主");
    for (const card of contactCards) expect(html).toContain(`放大${card.label}图片`);
  });
  it("is exposed on both the login page and signed-in sidebar", () => {
    const gate = readFileSync(new URL("../src/cloud/CloudGate.tsx", import.meta.url), "utf8");
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(gate).toContain("<ContactBlogger/>");
    expect(app).toContain('{ id: "contact", label: "联系博主"');
    expect(app).toContain('<ContactBlogger key={item.id} variant="sidebar"');
  });
});

import { describe, expect, it } from "vitest";
import { markdownToText, renderMarkdown as render } from "./markdown";

describe("markdown", () => {
  it("renders the reply shape the assistant actually writes", () => {
    const html = render([
      "检查了 2026 年 9 月的 10 条活动，发现 **1 组疑似重复**：",
      "",
      "- 「Skream!」 fripSide インタビュー掲載：",
      "`evt_e046ac39f1f0420dba0f91df48d908ac`",
      "- 「Skream!」インタビュー掲載：`evt_44c7eb2383aa40bfbc5f23e58bbb6ff2`",
      "",
      "两条均为 9 月 10 日的 fripSide 采访。",
    ].join("\n"));
    expect(html).toBe("<p>检查了 2026 年 9 月的 10 条活动，发现 <strong>1 组疑似重复</strong>：</p>"
      + "<ul><li>「Skream!」 fripSide インタビュー掲載：<br><code>evt_e046ac39f1f0420dba0f91df48d908ac</code></li>"
      + "<li>「Skream!」インタビュー掲載：<code>evt_44c7eb2383aa40bfbc5f23e58bbb6ff2</code></li></ul>"
      + "<p>两条均为 9 月 10 日的 fripSide 采访。</p>");
  });

  it("escapes everything the model writes", () => {
    expect(render("<script>alert(1)</script> & <img src=x onerror=1>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;img src=x onerror=1&gt;</p>");
    expect(render("`<b>` and **<i>**")).toBe("<p><code>&lt;b&gt;</code> and <strong>&lt;i&gt;</strong></p>");
    expect(render("```\n<script>x</script>\n```")).toBe("<pre><code>&lt;script&gt;x&lt;/script&gt;</code></pre>");
    expect(render('[x](https://a.example/"onmouseover="1)')).not.toContain('"onmouseover');
  });

  it("links only http and https", () => {
    expect(render("[官网公告](https://fripside.net/contents/1?a=1&b=2)"))
      .toBe('<p><a href="https://fripside.net/contents/1?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">官网公告</a></p>');
    expect(render("来源是 https://fripside.net/contents/1123461。"))
      .toBe('<p>来源是 <a href="https://fripside.net/contents/1123461" target="_blank" rel="noopener noreferrer">https://fripside.net/contents/1123461</a>。</p>');
    expect(render("[x](javascript:alert(1))")).toBe("<p>[x](javascript:alert(1))</p>");
    expect(render("[x](data:text/html,1)")).not.toContain("<a");
    expect(render("https://a.example/x_y_*z*")).toBe('<p><a href="https://a.example/x_y_*z*" target="_blank" rel="noopener noreferrer">https://a.example/x_y_*z*</a></p>');
  });

  it("handles emphasis without touching ids, sums or code", () => {
    expect(render("*斜体* 和 **粗体** 和 `**原样**`")).toBe("<p><em>斜体</em> 和 <strong>粗体</strong> 和 <code>**原样**</code></p>");
    expect(render("evt_a_b_c 与 2 * 3 * 4")).toBe("<p>evt_a_b_c 与 2 * 3 * 4</p>");
    expect(render("未闭合的 **粗体")).toBe("<p>未闭合的 **粗体</p>");
  });

  it("renders lists, headings, quotes, rules and line breaks", () => {
    expect(render("3. 三\n4. 四")).toBe('<ol start="3"><li>三</li><li>四</li></ol>');
    expect(render("1. 一\n\n- 甲\n* 乙")).toBe("<ol><li>一</li></ol><ul><li>甲</li><li>乙</li></ul>");
    expect(render("## 结果\n正文")).toBe("<h4>结果</h4><p>正文</p>");
    expect(render("> 引用\n> 第二行")).toBe("<blockquote>引用<br>第二行</blockquote>");
    expect(render("上\n---\n下")).toBe("<p>上</p><hr><p>下</p>");
    expect(render("第一行\n第二行\n\n\n新段落")).toBe("<p>第一行<br>第二行</p><p>新段落</p>");
    expect(render("")).toBe("");
  });

  it("shows a code block while its closing fence has not arrived", () => {
    expect(render("```json\n{\"a\": 1}")).toBe("<pre><code>{&quot;a&quot;: 1}</code></pre>");
  });

  it("uses the heading tag the page asks for", () => {
    expect(render("## 出演\n# 收录", { heading: "h2" })).toBe("<h2>出演</h2><h2>收录</h2>");
  });

  it("keeps the line breaks of descriptions written before Markdown", () => {
    expect(render("仅主唱及乐队全员出演\n终演后见送会实施\n\n开场16:00。")).toBe("<p>仅主唱及乐队全员出演<br>终演后见送会实施</p><p>开场16:00。</p>");
    expect(markdownToText("仅主唱及乐队全员出演\n终演后见送会实施\n\n开场16:00。")).toBe("仅主唱及乐队全员出演\n终演后见送会实施\n\n开场16:00。");
  });

  it("strips markup for plain-text readers", () => {
    const source = "## 出演\n**四位主唱**同台，*嘉宾* `angela`。\n\n- 收录\n- [官网公告](https://fripside.net/contents/1)\n\n1. 一\n2. 二\n\n> 引用\n\n---\n2 * 3 * 4";
    expect(markdownToText(source)).toBe("出演\n\n四位主唱同台，嘉宾 angela。\n\n・收录\n・官网公告\n\n1. 一\n2. 二\n\n引用\n\n2 * 3 * 4");
    expect(markdownToText("- [官网公告](https://fripside.net/contents/1)", { links: "url" })).toBe("・官网公告 https://fripside.net/contents/1");
    expect(markdownToText("<b> & 未闭合的 **粗体")).toBe("<b> & 未闭合的 **粗体");
  });
});

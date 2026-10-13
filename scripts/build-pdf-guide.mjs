/**
 * 参赛说明 PDF 构建脚本。
 *
 * Edge headless 打印 file:// 页面时子资源（截图）加载存在竞态，先把
 * 截图内嵌为 base64 data URI，打印即为全同步渲染，任何环境一次成功。
 * 产物：docs/pdf-build/spendct-guide.embedded.html（不入库，见 .gitignore）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DOCS = fileURLToPath(new URL("../docs/", import.meta.url));
const SHOTS = `${DOCS}../scripts/.shots/`;

/**
 * 目录页码（两遍法的第一遍产物，与当前 HTML 内容对应）。
 * 内容增删后重新打印一遍，用 fitz 重新取各章起始页刷新本表：
 *   python -c "import fitz; d=fitz.open('docs/SpendCT-参赛说明.pdf');
 *   [print(i+1, repr(p.get_text()[:40])) for i,p in enumerate(d)]"
 */
const TOC_PAGES = {
  c1: 3, c2: 4, c3: 6, c4: 7, c5: 8, c6: 9,
  c7: 11, c8: 12, c9: 15, c10: 16, c11: 17, c12: 18, c13: 18,
};

const source = readFileSync(`${DOCS}pdf-build/spendct-guide.html`, "utf8");

const embedded = source
  .replace(/src="\.\.\/scripts\/\.shots\/([^"]+)\.png"/g, (match, name) => {
    const data = readFileSync(`${SHOTS}${name}.png`).toString("base64");
    return `src="data:image/png;base64,${data}"`;
  })
  // headless 打印不支持 target-counter 自动页码：写入两遍法取得的页码
  .replace(/<a href="#(c\d+)"><\/a>/g, (match, id) => `<a href="#${id}">${TOC_PAGES[id]}</a>`);

const out = `${DOCS}pdf-build/spendct-guide.embedded.html`;
writeFileSync(out, embedded, "utf8");
console.log(`已内嵌 ${(embedded.match(/data:image\/png/g) || []).length} 张截图 → ${out}`);

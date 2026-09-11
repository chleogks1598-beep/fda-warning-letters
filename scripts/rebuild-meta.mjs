// 보존본(public/archive/<id>.html)에서 머리말 메타와 본문 텍스트를 **다시** 뽑는다.
//
//   node scripts/rebuild-meta.mjs
//
// 머리말 파서(fda-common.mjs 의 parseLetter)를 고쳤을 때 쓴다. FDA 를 다시 조회하지 않으므로
// 봇탐지에 걸릴 일도, 이미 내려간 원문을 잃을 일도 없다 — 보존본이 있으니 언제든 다시 만든다.
// LLM 추출 결과(extracted/)는 건드리지 않는다.
import fs from "fs";
import path from "path";
import { ROOT, parseLetter } from "./fda-common.mjs";

const ARCHIVE = path.join(ROOT, "public", "archive");
const META_DIR = path.join(ROOT, "newdocs", "meta");
const TXT_DIR = path.join(ROOT, "newdocs");
const KEEP_TXT = process.env.KEEP_TXT !== "0"; // 본문 텍스트도 다시 쓸지

fs.mkdirSync(META_DIR, { recursive: true });
let ok = 0,
  fail = 0;
for (const f of fs.readdirSync(ARCHIVE).filter((f) => f.endsWith(".html"))) {
  const id = f.replace(/\.html$/, "");
  try {
    const { text, meta } = parseLetter(fs.readFileSync(path.join(ARCHIVE, f), "utf8"));
    fs.writeFileSync(path.join(META_DIR, `${id}.json`), JSON.stringify(meta, null, 1));
    if (KEEP_TXT) fs.writeFileSync(path.join(TXT_DIR, `${id}.txt`), text);
    ok++;
  } catch (e) {
    fail++;
    console.error(`  ✗ ${id} — ${e.message}`);
  }
}
console.error(`보존본 ${ok}건 재파싱 · 실패 ${fail}건`);

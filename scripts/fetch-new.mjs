// 목록(newdocs/list.json) 중 **범위 내이면서 아직 본문을 받지 않은 건**의 상세 페이지를 받아
// 보존본과 LLM 입력 텍스트를 만든다.
//
//   node scripts/fetch-list.mjs && node scripts/fetch-new.mjs
//
// 출력
//   public/archive/<id>.html   원문 보존본 (FDA 가 페이지를 내려도 우리 쪽에 남는다)
//   newdocs/<id>.txt           본문 텍스트 (요약·지적사항 추출 입력)
//   newdocs/meta/<id>.json     머리말에서 규칙 기반으로 뽑은 필드(참조번호·FEI·수신자 등)
//   newdocs/manifest.json      이번에 본문을 확보한 건 목록
//
// ★ 이어받기: .txt 가 이미 있으면 건너뛴다. 514건 초기 소급 수집이 중간에 끊겨도 다시 돌리면 된다.
// ★ 보존본을 먼저 쓴 뒤 텍스트를 쓴다 — 원문 확보가 최우선이다.
import fs from "fs";
import path from "path";
import { ROOT, fetchLetterHtml, parseLetter, sleep } from "./fda-common.mjs";
import { inScope } from "./scope.mjs";

const LIST = path.join(ROOT, "newdocs", "list.json");
const TXT_DIR = path.join(ROOT, "newdocs");
const META_DIR = path.join(ROOT, "newdocs", "meta");
const ARCHIVE = path.join(ROOT, "public", "archive");
const MANIFEST = path.join(ROOT, "newdocs", "manifest.json");
const GAP_MS = Number(process.env.GAP_MS || 3000);
const LIMIT = Number(process.env.LIMIT || 0); // 0 = 무제한

/** <main> 안의 편지 본문을 그대로 담은, 혼자서도 열리는 보존본 HTML. */
function snapshot(rec, html) {
  const clean = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
  let body = (clean.match(/<main[\s\S]*?<\/main>/) || ["<main></main>"])[0];
  // 상대 링크는 원본으로 돌려놓는다(보존본에서 클릭해도 깨지지 않게).
  body = body.replace(/(href|src)="\/(?!\/)/g, '$1="https://www.fda.gov/');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${rec.company.replace(/[<>&]/g, "")} — FDA Warning Letter ${rec.letterDate}</title>
<style>
  body{margin:0;background:#f6f8fa;color:#1a2733;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Malgun Gothic",sans-serif;line-height:1.6}
  main{max-width:820px;margin:0 auto;padding:24px 18px 64px;background:#fff}
  .snapnote{max-width:820px;margin:0 auto;padding:10px 18px;background:#e7f0fc;color:#1367d6;
    font-size:13px;border-bottom:1px solid #cfe0f2}
  .snapnote a{color:inherit}
  img{max-width:100%} table{border-collapse:collapse;max-width:100%} td,th{border:1px solid #e2e8f0;padding:6px 8px}
  h1{font-size:22px} h2{font-size:17px}
</style>
</head>
<body>
<div class="snapnote">보존본 — ${rec.postedDate} 시점 FDA 원문 스냅샷. 원본: <a href="${rec.url}">${rec.url}</a></div>
${body}
</body>
</html>
`;
}

async function main() {
  if (!fs.existsSync(LIST)) {
    console.error("newdocs/list.json 이 없습니다 — scripts/fetch-list.mjs 를 먼저 실행하세요.");
    process.exit(1);
  }
  const list = JSON.parse(fs.readFileSync(LIST, "utf8")).filter(inScope);
  fs.mkdirSync(META_DIR, { recursive: true });
  fs.mkdirSync(ARCHIVE, { recursive: true });

  const todo = list.filter((r) => !fs.existsSync(path.join(TXT_DIR, `${r.id}.txt`)));
  const target = LIMIT ? todo.slice(0, LIMIT) : todo;
  console.error(`범위 내 ${list.length}건 / 본문 미확보 ${todo.length}건 / 이번 실행 ${target.length}건`);

  const got = [];
  const failed = [];
  for (let i = 0; i < target.length; i++) {
    const r = target[i];
    const html = await fetchLetterHtml(r.url);
    if (!html) {
      failed.push({ id: r.id, url: r.url, reason: "상세 페이지 취득 실패" });
      console.error(`  ✗ ${r.id} — 취득 실패`);
      await sleep(GAP_MS);
      continue;
    }
    let parsed;
    try {
      parsed = parseLetter(html);
    } catch (e) {
      failed.push({ id: r.id, url: r.url, reason: String(e.message || e) });
      console.error(`  ✗ ${r.id} — ${e.message}`);
      await sleep(GAP_MS);
      continue;
    }
    if (parsed.text.length < 800) {
      failed.push({ id: r.id, url: r.url, reason: `본문이 너무 짧음(${parsed.text.length}자)` });
      console.error(`  ✗ ${r.id} — 본문 ${parsed.text.length}자`);
      await sleep(GAP_MS);
      continue;
    }
    fs.writeFileSync(path.join(ARCHIVE, `${r.id}.html`), snapshot(r, html));
    fs.writeFileSync(path.join(META_DIR, `${r.id}.json`), JSON.stringify(parsed.meta, null, 1));
    fs.writeFileSync(path.join(TXT_DIR, `${r.id}.txt`), parsed.text);
    got.push({ id: r.id, company: r.company, letterDate: r.letterDate, chars: parsed.text.length });
    if ((i + 1) % 25 === 0 || i === target.length - 1)
      console.error(`  ${i + 1}/${target.length} — 확보 ${got.length} · 실패 ${failed.length}`);
    if (i < target.length - 1) await sleep(GAP_MS);
  }

  fs.writeFileSync(MANIFEST, JSON.stringify(got, null, 1));
  if (failed.length) fs.writeFileSync(path.join(TXT_DIR, "fetch-failed.json"), JSON.stringify(failed, null, 1));
  console.error(`본문 확보 ${got.length}건 · 실패 ${failed.length}건`);
  console.log(`NEW=${got.length}`);
  console.log(`FAIL=${failed.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

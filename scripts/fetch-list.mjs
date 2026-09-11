// FDA warning letter 목록을 전량 재조회해 newdocs/list.json 으로 떨어뜨린다.
//
//   node scripts/fetch-list.mjs
//
// 목록은 최신순이고 총 3,700건 안팎(2022년 이후)이다. length=300 씩 받아 빈 페이지가 나오면 멈춘다.
// ★ FDA 봇탐지 때문에 페이지 간 간격(GAP_MS)을 반드시 둔다.
import fs from "fs";
import path from "path";
import { ROOT, fetchListPage, sleep } from "./fda-common.mjs";

const PAGE = 300;
const GAP_MS = Number(process.env.GAP_MS || 3000);
const MAX_PAGES = 40; // 12,000건 — 안전장치

async function main() {
  const all = [];
  const seen = new Set();
  for (let i = 0; i < MAX_PAGES; i++) {
    const start = i * PAGE;
    const rows = await fetchListPage(start, PAGE);
    if (rows === null) {
      console.error(`목록 조회 실패 (start=${start}) — 중단합니다. 부분 목록은 저장하지 않습니다.`);
      process.exit(1);
    }
    console.error(`  목록 ${start}~${start + rows.length - 1} : ${rows.length}건`);
    if (!rows.length) break;
    for (const r of rows) {
      if (seen.has(r.id)) continue; // 페이지 경계 중복 방어
      seen.add(r.id);
      all.push(r);
    }
    if (rows.length < PAGE) break;
    await sleep(GAP_MS);
  }
  if (all.length < 100) {
    console.error(`수집 건수가 비정상적으로 적습니다(${all.length}건) — 구조 변경 의심. 중단합니다.`);
    process.exit(2);
  }
  const out = path.join(ROOT, "newdocs", "list.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(all, null, 1));
  console.error(`목록 ${all.length}건 → ${path.relative(ROOT, out)}`);
  console.log(`LIST=${all.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

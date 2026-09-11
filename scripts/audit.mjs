// 추출 결과를 원문과 대조해 **다시 뽑아야 할 건**을 찾아낸다.
//
//   node scripts/audit.mjs           점검만 (목록 출력)
//   node scripts/audit.mjs --purge   의심 건의 extracted/<id>.json 을 지운다 → 다음 추출에서 재처리
//
// 검사 항목
//  ① 지적사항 0건 — warning letter 는 본래 위반을 적는 문서라 0건은 거의 항상 판독 실패다.
//  ② 본문의 번호 매겨진 항목 수보다 추출이 **많다** — 번호 목록 밖 별도 소제목(Unapproved New
//     Drug / Misbranding / Field Alert Report 등)을 담은 정상 사례도 있으므로, 그중
//     **총괄 위반 근거(FD&C Act 501(a)(2)) 만 달랑 인용한 항목**이 있는 건만 의심으로 올린다.
//     그 문장은 번호 항목 전체를 법적으로 규정하는 말이지 별개의 지적이 아니다.
//  ③ 본문 번호 항목 수보다 추출이 **적다** — 빠뜨린 것.
import fs from "fs";
import path from "path";
import { ROOT } from "./fda-common.mjs";

const EXT = path.join(ROOT, "extracted");
const TXT = path.join(ROOT, "newdocs");
const PURGE = process.argv.includes("--purge");

/** 본문에서 1,2,3… 으로 **연속**하는 위반 항목 줄만 센다(각주·요구사항 목록 오인 방지). */
function numberedCount(txt) {
  let n = 0;
  for (const m of txt.matchAll(/^(\d{1,2})\.\s+(\S.{40,})$/gm)) if (Number(m[1]) === n + 1) n++;
  return n;
}
const isBlanketCite = (cfr) => /501\(a\)\(2\)/.test(cfr) && !/21 CFR/.test(cfr);

const suspects = [];
let total = 0;
for (const f of fs.readdirSync(EXT).filter((f) => f.endsWith(".json"))) {
  const id = f.replace(/\.json$/, "");
  const o = JSON.parse(fs.readFileSync(path.join(EXT, f), "utf8"));
  const txtPath = path.join(TXT, `${id}.txt`);
  if (!fs.existsSync(txtPath)) continue;
  total++;
  const n = numberedCount(fs.readFileSync(txtPath, "utf8"));
  const got = o.violations.length;
  let why = "";
  if (got === 0) why = "지적사항 0건";
  else if (n && got < n) why = `본문 ${n}개 > 추출 ${got}개 (누락 의심)`;
  else if (n && got > n && o.violations.some((v) => isBlanketCite(v.cfr)))
    why = `본문 ${n}개 < 추출 ${got}개 + 총괄 근거(501(a)(2)) 인용 항목 있음`;
  if (why) suspects.push({ id, why });
}

for (const s of suspects) console.log(`  ${s.id.slice(0, 56).padEnd(57)} ${s.why}`);
console.error(`추출 ${total}건 중 재처리 대상 ${suspects.length}건`);

if (PURGE) {
  for (const s of suspects) fs.rmSync(path.join(EXT, `${s.id}.json`), { force: true });
  console.error(`extracted/ 에서 ${suspects.length}건 삭제 — 다음 extract-local.mjs 실행이 다시 뽑습니다.`);
}
console.log(`SUSPECT=${suspects.length}`);

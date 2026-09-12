// 추출 결과를 점검해 **다시 뽑아야 할 건**을 찾아낸다.
//
//   node scripts/audit.mjs           점검만 (목록 출력)
//   node scripts/audit.mjs --purge   의심 건의 extracted/<id>.json 을 지운다 → 다음 추출에서 재처리
//
// ★ 기준은 **오탐이 거의 없는 것만** 남겼다. 시끄러운 점검은 없느니만 못하다 — 매번 정상 건이
//   목록에 오르면 사람이 아예 안 보게 된다.
//
// 【 버린 기준과 그 이유 — 다시 넣지 말 것 】
//  · "본문의 번호 매겨진 항목 수 ≠ 추출 건수" → 오탐이 대부분이었다(실측 200건 중 7건 지적,
//    확인해 보니 7건 전부 정상). 이유가 셋이다.
//      ① 번호 목록 밖 별도 소제목("Unapproved New Drug Violations", "Misbranding",
//         "Failure to Submit a Field Alert Report")이 정상적으로 담긴다.
//      ② 한 편지에 번호 목록이 두 벌 들어간다(CGMP 1~3, 이어서 FD&C Act 1~3).
//      ③ 위반 항목 설명 안에 중첩 번호 목록("1. 인용 문헌이 근거가 못 된다 2. …")이 들어간다.
//         ②와 ③은 본문만 봐서는 갈리지 않는다.
//  · "근거 조항이 FD&C Act 501(a)(2) 뿐" → API(원료) warning letter 는 21 CFR 211 이 적용되지
//    않아 항목별 CFR 인용이 아예 없다. 501(a)(2)(B) 가 유일한 근거인 게 정상이다.
import fs from "fs";
import path from "path";
import { ROOT } from "./fda-common.mjs";

const EXT = path.join(ROOT, "extracted");
const TXT = path.join(ROOT, "newdocs");
const PURGE = process.argv.includes("--purge");

/** 한글 음절 비율 — 번역이 통째로 빠진 건(영문 그대로)을 잡는다. */
const hangulRatio = (s) => {
  const t = (s || "").replace(/\s/g, "");
  if (!t) return 0;
  return (t.match(/[가-힣]/g) || []).length / t.length;
};

const suspects = [];
let total = 0;
for (const f of fs.readdirSync(EXT).filter((f) => f.endsWith(".json"))) {
  const id = f.replace(/\.json$/, "");
  let o;
  try {
    o = JSON.parse(fs.readFileSync(path.join(EXT, f), "utf8"));
  } catch (e) {
    suspects.push({ id, why: `JSON 이 깨졌음 — ${e.message.slice(0, 60)}` });
    continue;
  }
  total++;
  const v = o.violations || [];
  let why = "";

  // ① warning letter 는 본래 위반을 적는 문서다. 지적 0건은 거의 항상 판독 실패다.
  if (!v.length) why = "지적사항 0건";
  // ② 요약이 영문 그대로 남은 건 — 이 대시보드의 존재 이유가 한국어 정리다.
  else if (hangulRatio(o.summaryKo) < 0.2) why = `요약이 한국어가 아님 (한글 비율 ${(hangulRatio(o.summaryKo) * 100).toFixed(0)}%)`;
  else if (v.some((x) => hangulRatio(x.titleKo) < 0.2))
    why = "지적 표제가 한국어가 아님";
  // ③ 본문이 있는데 요약이 지나치게 짧으면 앞부분만 읽고 끝낸 것이다.
  else if (o.sourceChars > 8000 && o.summaryKo.length < 80) why = `본문 ${o.sourceChars}자인데 요약 ${o.summaryKo.length}자`;
  // ④ 같은 지적이 그대로 중복 — 항목을 잘못 쪼갠 흔적.
  else {
    const t = v.map((x) => x.titleKo.replace(/\s/g, ""));
    if (new Set(t).size !== t.length) why = "같은 지적 표제가 중복";
  }

  if (why) suspects.push({ id, why });
}

for (const s of suspects) console.log(`  ${s.id.slice(0, 56).padEnd(57)} ${s.why}`);
console.error(`추출 ${total}건 중 재처리 대상 ${suspects.length}건`);

if (PURGE) {
  for (const s of suspects) fs.rmSync(path.join(EXT, `${s.id}.json`), { force: true });
  console.error(`extracted/ 에서 ${suspects.length}건 삭제 — 다음 extract-local.mjs 실행이 다시 뽑습니다.`);
}
console.log(`SUSPECT=${suspects.length}`);

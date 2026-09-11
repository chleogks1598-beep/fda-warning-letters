// warning letter 본문 → 한국어 요약 + 지적사항(violation) 구조화. 로컬 PC 전용.
//
//   node scripts/extract-local.mjs            # 미추출 건 전부
//   LIMIT=5 node scripts/extract-local.mjs    # 5건만
//   CONCURRENCY=4 node scripts/extract-local.mjs
//
// 유료 API 키 대신 **로컬 Claude Code CLI(`claude -p`)** 를 호출한다 — 기존 구독으로 처리되므로
// API 비용이 없다. (nedrug-gmp 프로젝트의 scripts/extract-local.mjs 와 같은 경로.)
//
// 입력:  newdocs/<id>.txt  (+ newdocs/meta/<id>.json)
// 출력:  extracted/<id>.json   ← **건별 파일이 영구 저장소다.**
//        514건 소급 추출이 중간에 끊겨도 이어받고, FDA 가 원문을 내려도 추출 결과가 남는다.
//        public/data.json 은 여기서 언제든 다시 만들 수 있다(merge.mjs).
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { ROOT } from "./fda-common.mjs";
import { inScope } from "./scope.mjs";

const TXT_DIR = path.join(ROOT, "newdocs");
const META_DIR = path.join(ROOT, "newdocs", "meta");
const OUT_DIR = path.join(ROOT, "extracted");
const LIST = path.join(ROOT, "newdocs", "list.json");
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);
const LIMIT = Number(process.env.LIMIT || 0);

// 대시보드 필터가 쓰는 고정 분야 목록 — 모델이 자유롭게 만들면 필터가 무의미해진다.
export const AREAS = [
  "품질시스템",
  "문서·데이터완전성",
  "시험·QC",
  "제조·공정관리",
  "무균·멸균",
  "시설·장비",
  "원자재·공급자",
  "허가·표시",
  "기타",
];

const INSTRUCTION = `입력으로 주어지는 것은 미국 FDA 가 공개한 warning letter 전문(영문)이다.
의약품 제조소 QA 담당자가 읽을 **한국어 정리본**을 만들어라. **JSON 객체 하나만** 출력한다 —
설명·코드펜스·머리말 없이 객체 하나만 출력하라.

형식:
{
 "headlineKo": "표 한 줄에 들어갈 한국어 한 줄 요약 (45자 이내, 마침표 없이). 가장 무거운 지적 한두 개를 집어라. 예 \\"미생물시험 데이터 조작·OOS 무효화, 무균공정 기류 불량\\"",
 "summaryKo": "이 편지의 핵심을 한국어 3~4문장으로. 어느 시설을 언제 실사했고, 무엇이 몇 건 지적됐고, 회사 답변이 왜 부적절했고, FDA 가 취한 조치(수입경보·리콜권고·제조중단 등)가 무엇인지. 한 문장을 지나치게 길게 늘이지 마라.",
 "inspectionStart": "YYYY-MM-DD 또는 \\"\\"",
 "inspectionEnd": "YYYY-MM-DD 또는 \\"\\"",
 "facility": "실사받은 시설의 원문 주소 (영문 그대로). 없으면 \\"\\"",
 "form483ResponseDate": "회사가 Form FDA 483 에 답변한 날짜 YYYY-MM-DD, 없으면 \\"\\"",
 "violations": [
   {
     "no": 1,
     "cfr": "근거 조항 원문 (예 \\"21 CFR 211.194(a)\\", \\"FD&C Act 501(a)(2)(B)\\"). 명시 없으면 \\"\\"",
     "area": "아래 분야 목록 중 하나",
     "titleKo": "지적 표제 — 무엇을 위반했는지 한 문장(30자 내외)",
     "detailKo": "FDA 가 관찰한 구체 사실을 한국어 2~5문장으로. 수치·품목·설비명 등 구체적 사실을 살려라.",
     "responseKo": "회사 답변에 대한 FDA 평가를 한국어 1~3문장으로. 답변 언급이 없으면 \\"\\"",
     "dataIntegrity": true/false
   }
 ],
 "flags": {
   "importAlert": "수입경보 번호와 날짜 (예 \\"66-40 (2026-04-03)\\"). 없으면 \\"\\"",
   "recall": true/false,
   "consultantRecommended": true/false,
   "productionSuspended": true/false,
   "refusedInspection": true/false,
   "postWarningMeeting": true/false
 },
 "keywordsKo": ["핵심 키워드 3~6개 (예 \\"데이터 완전성\\", \\"OOS 조사\\", \\"무균공정 스모크테스트\\")"]
}

분야 목록 (area 는 반드시 이 중 하나):
${AREAS.map((a) => `- ${a}`).join("\n")}

규칙:
- violations 는 편지 본문의 **번호 매겨진 위반 항목**("1. Your firm failed to …")을 그 순서대로 담는다.
  번호가 없이 서술된 편지라면 문단 단위로 위반 사항을 갈라 no 를 1부터 붙여라.
- **번호 항목을 임의로 쪼개거나 합치지 마라.** 번호가 1~4 까지면 violations 도 4개다.
- 다만 번호 목록 **밖에 별도 소제목으로 서술된 위반**은 번호가 없어도 담아라. 실제로 자주 나온다:
  "Unapproved New Drug Violations" / "Misbranding" / "Failure to Submit a Field Alert Report" /
  "Drug Listing / Registration" 등. 이런 항목은 번호를 이어서(예 5, 6) 붙인다.
- 반대로 **총괄 위반 근거 서술은 지적사항이 아니다.** 서두·결론의
  "your drug products are adulterated within the meaning of section 501(a)(2)(B)",
  "prepared under insanitary conditions … 501(a)(2)(A)" 같은 문장은 번호 항목 전체를 묶어
  법적으로 규정하는 말이지 별개의 지적이 아니다. 이걸 따로 violation 으로 만들지 마라.
- 실제 회사의 규제 처분 정보다. **본문에 없는 내용을 지어내지 마라.** 확인되지 않는 필드는 빈 문자열/false.
- 본문의 (b)(4) 는 FDA 가 비공개 처리한 부분이다. 내용을 추측하지 말고 "(비공개)" 로 적거나 생략하라.
- detailKo·responseKo 는 한국어로 **요약**하되, 사실관계를 바꾸지 마라. 숫자·날짜는 본문 그대로.
- "In response to this letter, provide:" 뒤에 오는 FDA 요구사항 목록은 지적사항이 아니다.
  필요하면 responseKo 에 한 구절로만 언급하고, 별도 violation 으로 만들지 마라.
- Conclusion·CGMP Consultant Recommended·Quality Systems 같은 마무리 절도 violation 이 아니다.
  거기서 읽히는 사실은 flags 와 summaryKo 에 반영하라.
- violations 가 하나도 없으면 빈 배열을 출력하되, warning letter 는 본래 위반을 적는 문서이므로
  빈 배열은 거의 항상 판독 실패를 뜻한다. 다시 읽어보라.`;

function runClaude(docText) {
  return new Promise((resolve, reject) => {
    const p = spawn("claude", ["-p"], { shell: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = "",
      err = "";
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error("claude 응답 시간 초과(10분)"));
    }, 600000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      // 사용량 한도에 걸리면 claude 는 종료코드 1 과 함께 stderr 가 비어 있고 안내가 stdout 으로
      // 나오기도 한다. 둘 다 봐야 원인을 알 수 있다.
      if (code !== 0) return reject(new Error(`claude 종료코드 ${code}: ${(err.trim() || out.trim()).slice(0, 300)}`));
      resolve(out);
    });
    p.stdin.write(`${INSTRUCTION}\n\n본문:\n---\n${docText}\n---\n`);
    p.stdin.end();
  });
}

/** 모델이 앞뒤로 군말이나 코드펜스를 붙여도 객체만 건져내고, 스키마를 강제한다. */
function parseObject(raw) {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const a = s.indexOf("{"),
    b = s.lastIndexOf("}");
  if (a === -1 || b === -1 || b < a) throw new Error(`JSON 객체를 찾을 수 없음: ${s.slice(0, 200)}`);
  const o = JSON.parse(s.slice(a, b + 1));
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const bool = (v) => v === true;
  if (!str(o.summaryKo)) throw new Error("summaryKo 가 비었음");
  if (!str(o.headlineKo)) throw new Error("headlineKo 가 비었음");
  if (!Array.isArray(o.violations)) throw new Error("violations 가 배열이 아님");
  const violations = o.violations.map((v, i) => {
    const area = AREAS.includes(str(v.area)) ? str(v.area) : "기타";
    if (!str(v.titleKo)) throw new Error(`${i + 1}번 지적사항의 titleKo 가 비었음`);
    return {
      no: Number.isFinite(v.no) ? v.no : i + 1,
      cfr: str(v.cfr),
      area,
      titleKo: str(v.titleKo),
      detailKo: str(v.detailKo),
      responseKo: str(v.responseKo),
      dataIntegrity: bool(v.dataIntegrity),
    };
  });
  const f = o.flags || {};
  return {
    headlineKo: str(o.headlineKo),
    summaryKo: str(o.summaryKo),
    inspectionStart: /^\d{4}-\d{2}-\d{2}$/.test(str(o.inspectionStart)) ? str(o.inspectionStart) : "",
    inspectionEnd: /^\d{4}-\d{2}-\d{2}$/.test(str(o.inspectionEnd)) ? str(o.inspectionEnd) : "",
    facility: str(o.facility),
    form483ResponseDate: /^\d{4}-\d{2}-\d{2}$/.test(str(o.form483ResponseDate)) ? str(o.form483ResponseDate) : "",
    violations,
    flags: {
      importAlert: str(f.importAlert),
      recall: bool(f.recall),
      consultantRecommended: bool(f.consultantRecommended),
      productionSuspended: bool(f.productionSuspended),
      refusedInspection: bool(f.refusedInspection),
      postWarningMeeting: bool(f.postWarningMeeting),
    },
    keywordsKo: Array.isArray(o.keywordsKo) ? o.keywordsKo.map(str).filter(Boolean).slice(0, 8) : [],
  };
}

async function extractOne(id) {
  const txt = fs.readFileSync(path.join(TXT_DIR, `${id}.txt`), "utf8");
  const raw = await runClaude(txt);
  const rec = parseObject(raw);
  rec.id = id;
  rec.extractedAt = new Date().toISOString().slice(0, 19) + "Z";
  rec.sourceChars = txt.length;
  fs.writeFileSync(path.join(OUT_DIR, `${id}.json`), JSON.stringify(rec, null, 1));
  return rec;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const list = JSON.parse(fs.readFileSync(LIST, "utf8")).filter(inScope);
  const ids = list
    .map((r) => r.id)
    .filter((id) => fs.existsSync(path.join(TXT_DIR, `${id}.txt`)))
    .filter((id) => !fs.existsSync(path.join(OUT_DIR, `${id}.json`)));
  const target = LIMIT ? ids.slice(0, LIMIT) : ids;
  console.error(`추출 대상 ${target.length}건 (본문 확보분 중 미추출) · 동시 ${CONCURRENCY}`);
  if (!target.length) {
    console.log("EXTRACTED=0");
    console.log("FAIL=0");
    return;
  }

  let next = 0,
    ok = 0,
    streak = 0,
    halted = "";
  const failed = [];
  // ★ 연속 실패 차단기. claude 사용량 한도에 걸리면 **모든 호출이 즉시 종료코드 1** 로 떨어져,
  //   차단기가 없으면 몇 초 만에 남은 수백 건을 전부 '실패'로 태워버린다(실측: 179건).
  //   몇 건만 태우고 멈추면 다음 실행이 그대로 이어받는다 — 건별 파일이 저장소이기 때문.
  const HALT_AFTER = Number(process.env.HALT_AFTER || 5);
  const worker = async () => {
    while (next < target.length && !halted) {
      const id = target[next++];
      const n = next;
      try {
        const rec = await extractOne(id);
        ok++;
        streak = 0;
        console.error(`  ✓ ${n}/${target.length} ${id} — 지적 ${rec.violations.length}건`);
      } catch (e) {
        const reason = String(e.message || e).slice(0, 300);
        failed.push({ id, reason });
        streak++;
        console.error(`  ✗ ${n}/${target.length} ${id} — ${reason.slice(0, 160)}`);
        if (streak >= HALT_AFTER) {
          halted = reason;
          console.error(`  !! 연속 ${streak}건 실패 — 남은 ${target.length - n}건을 건드리지 않고 중단합니다.`);
          console.error(`     (사용량 한도라면 한도가 풀린 뒤 그대로 다시 실행하면 이어받습니다.)`);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, target.length) }, worker));

  if (failed.length) fs.writeFileSync(path.join(TXT_DIR, "extract-failed.json"), JSON.stringify(failed, null, 1));
  else fs.rmSync(path.join(TXT_DIR, "extract-failed.json"), { force: true });
  console.error(`추출 완료 ${ok}건 · 실패 ${failed.length}건${halted ? " · 연속 실패로 중단" : ""}`);
  console.log(`EXTRACTED=${ok}`);
  console.log(`FAIL=${failed.length}`);
  console.log(`HALTED=${halted ? "1" : "0"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

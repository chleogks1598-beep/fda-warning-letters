// 목록 메타 + 규칙 기반 머리말 + LLM 추출 결과를 합쳐 public/data.json 을 다시 쓴다.
//
//   node scripts/merge.mjs
//
// ★ **FDA 가 원문을 내려도 우리 대시보드에는 남는다** — 이 파일이 그 약속을 지키는 지점이다.
//   FDA 는 일정 기간이 지나면 warning letter 를 목록에서 내린다. 이번 목록에 없는데
//   과거 우리 데이터에는 있던 건은 지우지 않고 `delisted:true` 로 표시해 계속 싣는다.
//   원문 스냅샷(public/archive/<id>.html)과 추출 결과(extracted/<id>.json)가 모두 저장소에
//   들어 있으므로, FDA 링크가 죽어도 내용은 읽을 수 있다.
//
// ★ 추출이 안 된 건을 **'지적사항 없음'으로 만들지 않는다.** warning letter 는 본래 위반을
//   적는 문서라 지적 0건은 거의 항상 판독 실패다. 그런 건은 status='요약 대기' 로 싣고
//   defCount 를 null 로 둔다 — 집계에서도 빠지고 대시보드에서도 구분 표시된다.
//   (nedrug-gmp 에서 미추출 건이 '적합'으로 공개된 구멍을 겪은 뒤 세운 규칙이다.)
import fs from "fs";
import path from "path";
import { ROOT } from "./fda-common.mjs";
import { inScope, category } from "./scope.mjs";

const LIST = path.join(ROOT, "newdocs", "list.json");
const META_DIR = path.join(ROOT, "newdocs", "meta");
const EXT_DIR = path.join(ROOT, "extracted");
const OUT = path.join(ROOT, "public", "data.json");

const readJson = (p, dflt = null) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return dflt;
  }
};
const today = () => new Date().toISOString().slice(0, 10);

/** 한 건의 공개 레코드를 만든다. list 행(또는 과거 레코드)과 추출·머리말을 합친다. */
function build(base, meta, ext) {
  const violations = ext ? ext.violations : [];
  const rec = {
    id: base.id,
    url: base.url,
    archive: fs.existsSync(path.join(ROOT, "public", "archive", `${base.id}.html`)) ? `archive/${base.id}.html` : "",
    company: base.company,
    office: base.office,
    subject: base.subject,
    category: category(base.subject),
    postedDate: base.postedDate,
    letterDate: base.letterDate,
    responseDate: base.responseDate || "",
    closeoutDate: base.closeoutDate || "",
    // 머리말(규칙 기반)
    marcsCms: meta?.marcsCms || "",
    referenceNo: meta?.referenceNo || "",
    fei: meta?.fei || "",
    product: meta?.product || "",
    recipientName: meta?.recipientName || "",
    recipientTitle: meta?.recipientTitle || "",
    address: shortAddress(meta?.address || "", base.company),
    country: normCountry(meta?.country || ""),
    // 추출(LLM)
    headlineKo: ext?.headlineKo || "",
    summaryKo: ext?.summaryKo || "",
    facility: ext?.facility || "",
    inspectionStart: ext?.inspectionStart || "",
    inspectionEnd: ext?.inspectionEnd || "",
    form483ResponseDate: ext?.form483ResponseDate || "",
    keywordsKo: ext?.keywordsKo || [],
    violations,
    defCount: ext ? violations.length : null,
    flags: ext?.flags || {
      importAlert: "",
      recall: false,
      consultantRecommended: false,
      productionSuspended: false,
      refusedInspection: false,
      postWarningMeeting: false,
    },
    status: ext ? "정리완료" : "요약 대기",
    closed: !!base.closeoutDate,
    delisted: false,
    delistedSince: "",
  };
  return rec;
}

/**
 * 주소 블록의 첫 줄은 회사명이라 대시보드에서 회사명이 두 번 보인다. 첫 줄이 회사명과
 * 사실상 같으면 떼어낸다(표기 차이 "Inc." / "Inc" / 쉼표 유무를 무시하고 비교).
 */
function shortAddress(address, company) {
  const parts = address.split(", ");
  if (parts.length < 2) return address;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const c = norm(company);
  if (!c) return address;
  // 회사명에도 쉼표가 들어간다("Happy Farm Botanicals, Inc.") — 앞쪽 조각을 여러 개까지 묶어보고
  // **가장 길게 일치하는 만큼** 떼어낸다. 한 조각만 비교하면 "Inc." 가 주소 앞에 남는다.
  const max = Math.min(3, parts.length - 1);
  const pre = (n) => norm(parts.slice(0, n).join(""));
  // ① 회사명과 **정확히** 일치하는 조합을 먼저 찾는다. 이게 없을 때만 부분일치로 내려간다.
  //    - 정확일치를 우선하지 않으면 "Happy Farm Botanicals, Inc." 에서 n=1("Happy Farm
  //      Botanicals")이 회사명의 앞부분이라 먼저 맞아 주소가 "Inc., 3708 West Street…" 가 된다.
  //    - n 은 작은 쪽부터 — 내림차순이면 회사명 뒤 건물명("…Limited, Galaxy")까지 잘린다.
  for (let n = 1; n <= max; n++) if (pre(n) === c) return parts.slice(n).join(", ");
  // ② 부분일치. 길이 상한이 없으면 "Jabil Inc." 가 "Jabil Inc., 10800 Roosevelt Blvd. N.,
  //    St. Petersburg" 전체와도 startsWith 로 맞아버려 번지까지 잘려나간다.
  for (let n = 1; n <= max; n++) {
    const a = pre(n);
    if (!a || a.length > c.length + 4) continue;
    if (c.startsWith(a) ? a.length >= 8 : a.startsWith(c)) return parts.slice(n).join(", ");
  }
  return address;
}

/** 주소 마지막 줄에서 온 국가명을 대시보드 필터용으로 다듬는다. */
function normCountry(c) {
  const s = (c || "").replace(/\(b\)\(\d\)/g, "").trim();
  if (!s) return "";
  if (/^United States$/i.test(s) || /\b[A-Z]{2}\s+\d{5}/.test(s)) return "United States";
  if (/Korea/i.test(s)) return "South Korea";
  if (/China|P\.?R\.?C/i.test(s)) return "China";
  if (/Taiwan/i.test(s)) return "Taiwan";
  // "Maharashtra India" 처럼 주(州)와 붙어 오는 경우 마지막 낱말 묶음을 쓴다.
  return s.replace(/^.*,\s*/, "").trim();
}

function main() {
  const list = readJson(LIST);
  if (!Array.isArray(list) || list.length < 100) {
    console.error("newdocs/list.json 이 없거나 비정상입니다 — fetch-list.mjs 를 먼저 실행하세요.");
    process.exit(1);
  }
  const scoped = list.filter(inScope);
  const prev = readJson(OUT, { records: [] });
  const prevById = new Map((prev.records || []).map((r) => [r.id, r]));

  const records = [];
  const seen = new Set();
  for (const row of scoped) {
    seen.add(row.id);
    const meta = readJson(path.join(META_DIR, `${row.id}.json`));
    const ext = readJson(path.join(EXT_DIR, `${row.id}.json`));
    records.push(build(row, meta, ext));
  }

  // 이번 목록에 없지만 과거에 우리가 담았던 건 — 보존한다.
  // ★ 단, **FDA 가 내린 건과 우리가 범위에서 뺀 건을 구분한다.** scope.mjs 판정을 고쳐
  //   범위에서 빠진 건(예: 의료기기 전용으로 재판정된 건)은 FDA 목록에 그대로 있으므로
  //   '목록에서 내려감' 이 아니다. 그런 건은 조용히 빠져야 한다 — 아니면 판정을 고칠 때마다
  //   가짜 '내려감' 레코드가 쌓인다.
  const inFullList = new Set(list.map((r) => r.id));
  let delisted = 0,
    dropped = 0;
  for (const [id, old] of prevById) {
    if (seen.has(id)) continue;
    if (inFullList.has(id)) {
      dropped++;
      continue;
    }
    const meta = readJson(path.join(META_DIR, `${id}.json`));
    const ext = readJson(path.join(EXT_DIR, `${id}.json`));
    const rec = build(old, meta, ext);
    rec.delisted = true;
    rec.delistedSince = old.delistedSince || today();
    records.push(rec);
    delisted++;
  }

  // 게시일 내림차순 — 같은 날은 편지 발행일 내림차순.
  records.sort((a, b) => b.postedDate.localeCompare(a.postedDate) || b.letterDate.localeCompare(a.letterDate));
  records.forEach((r, i) => (r.seq = records.length - i));

  const pending = records.filter((r) => r.status === "요약 대기").length;
  const out = {
    generatedAt: new Date().toISOString().slice(0, 19) + "Z",
    source: "https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/compliance-actions-and-activities/warning-letters",
    scope: "의약품(바이오의약품 포함) CGMP 관련 warning letter",
    listTotal: list.length,
    total: records.length,
    pending,
    delisted,
    records,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  const defs = records.reduce((s, r) => s + (r.defCount || 0), 0);
  console.error(
    `public/data.json — 총 ${records.length}건 (요약 대기 ${pending} · 목록에서 내려간 건 ${delisted}${dropped ? ` · 범위에서 제외 ${dropped}` : ""}) / 지적사항 ${defs}건`
  );
  console.log(`TOTAL=${records.length}`);
  console.log(`PENDING=${pending}`);
}

main();

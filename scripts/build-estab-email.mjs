// FDA 등록 의약품 제조소(DECRS)에 **대한민국 원료의약품·완제의약품 제조소**가 새로 올라오면 알림 메일 본문.
//
//   node scripts/build-estab-email.mjs <prev-establishments.json>
//   SAMPLE=3 node scripts/build-estab-email.mjs /dev/null      한국 대상 3곳으로 견본 메일(드라이런)
//
// 결과: ./estab-email-body.html + stdout "SEND=true|false" (+ GitHub Actions output)
// 수신자: recipients.json (warning letter 알림과 같은 목록)
//
// 판정
//  - 신규 = 직전 커밋의 records 에 없던 DUNS. 직전에 removed 에 있던 곳이면 '재등록' 표시.
//  - 원료의약품 = 업무에 API MANUFACTURE, 완제의약품 = MANUFACTURE (FDA 등록 업무 구분 그대로).
//    포장·표시·시험만 하는 곳은 보내지 않는다.
//  - 기존 제조소가 업무만 추가한 경우(예: 시험 → 제조)는 '신규 등록'이 아니므로 보내지 않는다.
// ★ 직전 파일이 없거나 비정상(5,000건 미만)이면 전부 '신규'로 보이므로 보내지 않는다 —
//   첫 커밋·파일 손상 때 수백 곳 메일이 한꺼번에 나가는 사고를 막는다.
import fs from "fs";
import path from "path";
import { ROOT } from "./fda-common.mjs";

const RECIP = path.join(ROOT, "recipients.json");
const SITE = process.env.SITE_URL || "https://chleogks1598-beep.github.io/fda-warning-letters";
const SAMPLE = parseInt(process.env.SAMPLE || "0", 10);
const MIN_PREV = 5000;

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const readJson = (p, dflt) => {
  try {
    return p && fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : dflt;
  } catch {
    return dflt;
  }
};
function emitOutput(obj) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(obj).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
}
function noSend(why) {
  emitOutput({ send: "false" });
  console.log(`SEND=false (${why})`);
  process.exit(0);
}

const recipients = readJson(RECIP, []).filter((x) => typeof x === "string" && x.includes("@"));
// 수신자가 없을 때 조용히 끝나면 알림이 영구히 안 가는데 아무도 모른다 → 빨간불.
if (!recipients.length) {
  console.error("수신자가 없습니다 — recipients.json 을 확인하세요.");
  emitOutput({ send: "false" });
  process.exit(1);
}

const OPS = {
  "MANUFACTURE": "제조", "API MANUFACTURE": "원료의약품 제조", "ANALYSIS": "시험", "LABEL": "표시",
  "PACK": "포장", "REPACK": "재포장", "RELABEL": "재표시", "STERILIZE": "멸균",
  "MEDICATED ANIMAL FEED MANUFACTURE": "약용 사료 제조", "POSITRON EMISSION TOMOGRAPHY DRUG PRODUCTION": "PET 의약품 생산",
  "TRANSFILL": "의료가스 충전", "PARTICLE SIZE REDUCTION": "입자 분쇄", "DISTRIBUTE": "유통",
  "SALVAGE": "회수품 재생", "SIP FOREIGN SELLER": "SIP 해외 판매자",
};
const isApi = (r) => (r.ops || []).includes("API MANUFACTURE");
const isFdf = (r) => (r.ops || []).includes("MANUFACTURE");
const target = (r) => r.cc === "KOR" && (isApi(r) || isFdf(r));

const cur = readJson(path.join(ROOT, "public", "establishments.json"), { records: [] });
const curRecs = cur.records || [];
let fresh;
let prevRemoved = new Set();
if (SAMPLE > 0) {
  fresh = curRecs.filter(target).slice(0, SAMPLE);
} else {
  const prev = readJson(process.argv[2], { records: [] });
  if ((prev.records || []).length < MIN_PREV) noSend(`직전 스냅샷 ${(prev.records || []).length}건 — 비교 불가`);
  if (curRecs.length < MIN_PREV) noSend(`현재 스냅샷 ${curRecs.length}건 — 비정상`);
  const had = new Set(prev.records.map((r) => r.duns));
  prevRemoved = new Set((prev.removed || []).map((r) => r.duns));
  fresh = curRecs.filter((r) => target(r) && !had.has(r.duns));
}
if (!fresh.length) noSend("대한민국 원료·완제 제조소 신규 등록 없음");

// ── 화장품 회사 거르기 (완제만 등록한 곳에 한해, '확실한 것'만) ──────────────────────────
// FDA 'MANUFACTURE' 에는 미국에서 OTC 의약품으로 분류되는 자외선차단제·손소독제를 만드는 화장품 회사가
// 대거 들어 있다(한국 완제 121곳 중 상당수). 그러나 DECRS 에는 제품 정보가 없고, NDC 제품 목록에는
// 판매사(labeler)만 있고 제조소가 없어 **둘을 확실히 잇는 방법이 없다**(2026-10-13 실측: 108곳 중
// 회사명으로 NDC 가 잡히는 곳 61곳, 그중 '의약품' 판정의 절반 이상이 달팽이·판테놀 같은 화장품 OTC).
// 그래서 확실한 경우만 뺀다 — 진짜 제약사를 놓치는 쪽이 화장품 메일 한 통보다 나쁘다.
//   ① 회사명에 cosmetic·beauty, 또는 '~cos' 로 끝나는 단어(HANACOS, MEGACOS …)
//   ② 회사명(또는 등록자명)으로 찾은 NDC 제품이 1개 이상이고, 전문·허가(NDA/ANDA/BLA)·원료 품목이 0개이며
//      주성분이 전부 자외선차단·손소독·피부보호·비듬·여드름·치약 불소 성분
// 원료의약품(API MANUFACTURE)을 함께 등록한 곳은 거르지 않는다. 조회 실패는 '거르지 않음'.
const COS_NAME = /cosmetic|beauty|\b\w*cos\b/i;
const COS_ING = /^(ZINC OXIDE|TITANIUM DIOXIDE|AVOBENZONE|OCTINOXATE|OCTOCRYLENE|HOMOSALATE|OCTISALATE|OXYBENZONE|ENSULIZOLE|ECAMSULE|BEMOTRIZINOL|BISOCTRIZOLE|DIOXYBENZONE|PADIMATE|ALCOHOL|ETHYL ALCOHOL|ISOPROPYL ALCOHOL|BENZALKONIUM CHLORIDE|BENZETHONIUM CHLORIDE|CHLOROXYLENOL|TRICLOSAN|GLYCERIN|DIMETHICONE|ALLANTOIN|PETROLATUM|WHITE PETROLATUM|COLLOIDAL OATMEAL|LANOLIN|COCOA BUTTER|SHEA BUTTER|MINERAL OIL|SALICYLIC ACID|BENZOYL PEROXIDE|SULFUR|PYRITHIONE ZINC|SELENIUM SULFIDE|COAL TAR|SODIUM FLUORIDE|SODIUM MONOFLUOROPHOSPHATE|STANNOUS FLUORIDE|ADENOSINE|NIACINAMIDE|ARBUTIN)\b/;
const RX_PROD = /PRESCRIPTION|BULK|FURTHER PROCESSING|VACCINE|PLASMA|CELLULAR|\bNDA\b|\bANDA\b|\bBLA\b/;
/** "Kolmar Korea Co.,Ltd. Bucheon Factory" → "Kolmar Korea" (NDC 검색용) */
const shortName = (s) =>
  String(s || "").replace(/_.*$/, "").replace(/\(.*\)/, "")
    .replace(/\b(co\.?,?\s*ltd\.?|co\.?\s*ltd|co\.,?|corp\.?|corporation|inc\.?|ltd\.?|llc)\b.*$/i, "")
    .replace(/[.,\s]+$/, "").trim();

async function ndcProducts(name) {
  const q = encodeURIComponent(`labeler_name:"${name}"`);
  const res = await fetch(`https://api.fda.gov/drug/ndc.json?search=${q}&limit=1000`);
  if (res.status === 404) return []; // openFDA 는 결과 0건을 404 로 준다
  if (!res.ok) throw new Error(`openFDA HTTP ${res.status}`);
  return (await res.json()).results || [];
}
/** @returns {Promise<{cosmetic:boolean, why:string}>} */
async function cosmeticCheck(r) {
  if (isApi(r)) return { cosmetic: false, why: "원료의약품 등록" };
  if (COS_NAME.test(r.name) || COS_NAME.test(r.reg)) return { cosmetic: true, why: "회사명(화장품)" };
  const names = [...new Set([shortName(r.name), shortName(r.reg)].filter((n) => n.length >= 3))];
  let prods = [];
  try {
    for (const n of names) prods = prods.concat(await ndcProducts(n));
  } catch (e) {
    return { cosmetic: false, why: `FDA 제품 조회 실패(${e.message})` };
  }
  if (!prods.length) return { cosmetic: false, why: "FDA 제품 목록에서 회사명 확인 안 됨" };
  const rx = prods.filter((p) => RX_PROD.test(`${p.product_type} ${p.marketing_category}`));
  if (rx.length) return { cosmetic: false, why: `FDA 제품 ${prods.length}품목 중 전문·허가 ${rx.length}품목` };
  const ings = [...new Set(prods.flatMap((p) => (p.active_ingredients || []).map((a) => String(a.name).toUpperCase())))];
  const other = ings.filter((i) => !COS_ING.test(i));
  if (ings.length && !other.length) return { cosmetic: true, why: `FDA 제품 ${prods.length}품목 전부 화장품성 OTC` };
  return { cosmetic: false, why: `FDA 제품 ${prods.length}품목(OTC · ${other.slice(0, 3).join(", ").toLowerCase()} 등)` };
}

const why = new Map();
const skipped = []; // 메일 하단에 이름을 남긴다 — 잘못 걸러진 제약사가 있으면 사람이 알아챌 수 있게
for (const r of fresh) {
  const c = await cosmeticCheck(r);
  why.set(r.duns, c.why);
  if (c.cosmetic) skipped.push(r);
}
const skippedText = skipped.map((r) => `${r.name} (${why.get(r.duns)})`);
if (skipped.length) console.error(`화장품으로 판단해 제외 ${skipped.length}곳:\n  ${skippedText.join("\n  ")}`);
fresh = fresh.filter((r) => !skipped.includes(r));
if (!fresh.length) noSend(`신규 ${skipped.length}곳 모두 화장품으로 판단해 제외`);

const F = {
  wrap: "font-family:'Malgun Gothic',Arial,sans-serif;color:#1a2733;font-size:14px;line-height:1.6",
  td: "border:1px solid #e2e8f0;padding:6px 8px;font-size:12px;vertical-align:top",
  th: "border:1px solid #e2e8f0;padding:6px 8px;font-size:12px;background:#f0f3f6;text-align:left;white-space:nowrap",
  tbl: "border-collapse:collapse;width:100%;border:1px solid #e2e8f0",
  badge: "display:inline-block;padding:1px 6px;border-radius:10px;font-size:11px;font-weight:bold;margin-right:3px",
};
const kind = (r) =>
  [
    isApi(r) && `<span style="${F.badge};background:#e7f0fc;color:#1367d6">원료의약품</span>`,
    isFdf(r) && `<span style="${F.badge};background:#e2f4ec;color:#0f8a5f">완제의약품</span>`,
    prevRemoved.has(r.duns) && `<span style="${F.badge};background:#fdece2;color:#c2410c">재등록</span>`,
  ].filter(Boolean).join("");

const rows = fresh
  .map((r) => {
    const link = `${SITE}/establishments.html#q=${encodeURIComponent(r.fei || r.duns)}`;
    return `<tr>
  <td style="${F.td}"><b>${esc(r.name)}</b><div style="margin-top:3px">${kind(r)}</div>
    <div style="color:#78889a;font-size:11px;margin-top:3px">${esc(r.addr)}</div></td>
  <td style="${F.td}">${(r.ops || []).map((o) => esc(OPS[o] || o)).join(", ")}
    <div style="color:#78889a;font-size:11px;margin-top:4px">${esc(why.get(r.duns))}</div></td>
  <td style="${F.td};white-space:nowrap">FEI ${esc(r.fei) || "—"}<br>DUNS ${esc(r.duns)}<br>만료 ${esc(r.exp) || "—"}</td>
  <td style="${F.td}">${r.reg ? `등록자 ${esc(r.reg)}<br>` : ""}${r.agent ? `미국 대리인 ${esc(r.agent)}<br>` : ""}
    <a href="${esc(link)}" style="color:#1367d6;font-size:11px">대시보드에서 보기</a></td>
</tr>`;
  })
  .join("");

const api = fresh.filter(isApi).length, fdf = fresh.filter(isFdf).length;
const html = `<div style="${F.wrap}">
<div style="font-size:17px;font-weight:bold;margin-bottom:4px">FDA 등록 의약품 제조소 — 대한민국 신규 등록</div>
<div style="color:#78889a;font-size:12px;margin-bottom:12px">
  ${esc((cur.generatedAt || "").replace("T", " ").replace("Z", " UTC"))} 기준 ·
  신규 ${fresh.length}곳 (원료의약품 ${api} · 완제의약품 ${fdf}${api + fdf > fresh.length ? " · 중복 포함" : ""}) ·
  FDA 등록 제조소 전체 ${(cur.total || 0).toLocaleString()}곳
</div>
<table style="${F.tbl}"><thead><tr>
  <th style="${F.th}">제조소</th><th style="${F.th}">등록 업무</th><th style="${F.th}">번호 · 만료</th><th style="${F.th}">등록자 · 링크</th>
</tr></thead><tbody>${rows}</tbody></table>
${skipped.length ? `<div style="margin-top:10px;color:#78889a;font-size:11px">화장품으로 판단해 제외한 신규 ${skipped.length}곳: ${skippedText.map(esc).join(" · ")}</div>` : ""}
<div style="margin-top:20px;font-size:12px">
  <a href="${SITE}/establishments.html#country=South%20Korea" style="color:#1367d6;font-weight:bold">대한민국 등록 제조소 전체 보기 →</a>
</div>
<div style="margin-top:14px;color:#78889a;font-size:11px;line-height:1.7">
  FDA DECRS(Drug Establishments Current Registration Site)에 직전 갱신 때 없던 사업장(DUNS)이 새로 나타난 경우입니다.
  원료의약품 = 등록 업무 'API MANUFACTURE', 완제의약품 = 'MANUFACTURE'(FDA 구분). 완제만 등록한 곳 중 회사명이나 FDA 제품 목록으로
  화장품이 확실한 곳은 제외했고, 판별되지 않는 곳은 그대로 보냅니다(화장품 회사가 섞일 수 있습니다).<br>
  FDA 공개 데이터를 정리한 참고용이며 공식 자료가 아닙니다.
</div>
</div>`;

fs.writeFileSync(path.join(ROOT, "estab-email-body.html"), html);
const subject = `[FDA 등록 제조소] 대한민국 신규 ${fresh.length}곳 — ${fresh[0].name}${fresh.length > 1 ? ` 외 ${fresh.length - 1}곳` : ""}`;
emitOutput({ send: "true", subject, to: recipients.join(",") });
console.log(`SEND=true 신규 ${fresh.length}곳 SUBJECT=${subject} TO=${recipients.join(",")}`);

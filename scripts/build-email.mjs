// 신규 warning letter 알림 메일 본문 생성.
//
//   node scripts/build-email.mjs <prev-data.json>
//
// 직전 스냅샷과 비교해 ①새로 올라온 편지 ②Close-out(종결)된 편지 ③FDA 목록에서 내려간 편지
// ④요약이 새로 붙은 편지를 뽑는다.
// 결과: ./email-body.html + stdout "SEND=true|false" (+ GitHub Actions output)
// 수신자: recipients.json
import fs from "fs";
import path from "path";
import { ROOT } from "./fda-common.mjs";

const RECIP = path.join(ROOT, "recipients.json");
const SITE = process.env.SITE_URL || "https://chleogks1598-beep.github.io/fda-warning-letters";
const SAMPLE = parseInt(process.env.SAMPLE || "0", 10);

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const readJson = (p, dflt) => {
  try {
    return p && fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : dflt;
  } catch {
    return dflt;
  }
};
function emitOutput(obj) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(obj)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n"
  );
}

let recipients = [];
let recipError = "";
try {
  recipients = readJson(RECIP, []).filter((x) => typeof x === "string" && x.includes("@"));
} catch (e) {
  recipError = e.message;
}
if (!recipients.length && process.env.RECIPIENT) recipients = [process.env.RECIPIENT];
// ★ 수신자가 없을 때 조용히 성공으로 끝내면 알림이 영구히 안 가는데 아무도 모른다.
//   빨간불로 실패시켜 사람이 알아차리게 한다.
if (!recipients.length) {
  console.error(`수신자가 없습니다 — recipients.json 을 확인하세요.${recipError ? " (" + recipError + ")" : ""}`);
  emitOutput({ send: "false" });
  process.exit(1);
}

const cur = readJson(path.join(ROOT, "public", "data.json"), { records: [] });
const prev = readJson(process.argv[2], { records: [] });
const prevById = new Map((prev.records || []).map((r) => [r.id, r]));
const curRecs = cur.records || [];

let fresh, closed, gone;
let summarized;
if (SAMPLE > 0) {
  fresh = curRecs.filter((r) => !r.delisted).slice(0, SAMPLE);
  closed = [];
  gone = [];
  summarized = [];
} else {
  fresh = curRecs.filter((r) => !prevById.has(r.id));
  closed = curRecs.filter((r) => r.closed && prevById.has(r.id) && !prevById.get(r.id).closed);
  gone = curRecs.filter((r) => r.delisted && prevById.has(r.id) && !prevById.get(r.id).delisted);
  summarized = curRecs.filter(
    (r) => r.status === "정리완료" && prevById.has(r.id) && prevById.get(r.id).status === "요약 대기"
  );
}

// ★ 소급 추출(backfill) 중에는 '요약완료' 알림을 보내지 않는다.
//   512건을 소급 정리하는 동안은 회차마다 수십 건씩 요약이 붙는데, 그걸 매번 메일로 보내면
//   정작 중요한 '신규 warning letter' 알림이 묻힌다. 평소 회차(신규 몇 건이 뒤늦게 정리된 경우)
//   는 보내는 게 맞으므로 건수로 가른다.
const BACKFILL_AT = Number(process.env.BACKFILL_AT || 10);
const backfill = summarized.length > BACKFILL_AT;
if (backfill) summarized = [];

if (!fresh.length && !closed.length && !gone.length && !summarized.length) {
  emitOutput({ send: "false" });
  console.log(`SEND=false${backfill ? " (소급 추출 중 — 요약완료 알림 생략)" : ""}`);
  process.exit(0);
}

const F = {
  wrap: "font-family:'Malgun Gothic',Arial,sans-serif;color:#1a2733;font-size:14px;line-height:1.6",
  h2: "font-size:15px;margin:22px 0 8px;padding-bottom:6px;border-bottom:2px solid #1367d6;color:#1367d6",
  td: "border:1px solid #e2e8f0;padding:6px 8px;font-size:12px;vertical-align:top",
  th: "border:1px solid #e2e8f0;padding:6px 8px;font-size:12px;background:#f0f3f6;text-align:left;white-space:nowrap",
  tbl: "border-collapse:collapse;width:100%;border:1px solid #e2e8f0",
  badge: "display:inline-block;padding:1px 6px;border-radius:10px;font-size:11px;font-weight:bold",
};

/** 한 건을 표 두 줄(요약행 + 지적사항행)로 그린다. 그룹웨어·메일 클라이언트 대비 인라인 style. */
function rowsFor(r) {
  const flags = [];
  if (r.flags?.importAlert) flags.push(`<span style="${F.badge};background:#fde7ed;color:#b3123c">수입경보</span>`);
  if (r.flags?.productionSuspended)
    flags.push(`<span style="${F.badge};background:#fde7ed;color:#b3123c">제조중단</span>`);
  if (r.flags?.recall) flags.push(`<span style="${F.badge};background:#fdece2;color:#c2410c">리콜/회수</span>`);
  if ((r.violations || []).some((v) => v.dataIntegrity))
    flags.push(`<span style="${F.badge};background:#fde7ed;color:#b3123c">데이터 완전성</span>`);
  const defs = (r.violations || [])
    .map(
      (v) =>
        `<div style="margin:3px 0"><b>${esc(v.no)}. ${esc(v.titleKo)}</b>` +
        `<span style="color:#78889a"> · ${esc(v.area)}${v.cfr ? " · " + esc(v.cfr) : ""}</span></div>`
    )
    .join("");
  return `<tr>
  <td style="${F.td};white-space:nowrap">${esc(r.postedDate)}</td>
  <td style="${F.td}"><b>${esc(r.company)}</b><div style="color:#78889a;font-size:11px">${esc(r.country)} · ${esc(
    r.category
  )}</div>${flags.length ? `<div style="margin-top:3px">${flags.join(" ")}</div>` : ""}</td>
  <td style="${F.td}">${esc(r.headlineKo) || "<i style='color:#78889a'>요약 대기</i>"}
    ${defs ? `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed #e2e8f0">${defs}</div>` : ""}
    <div style="margin-top:6px"><a href="${esc(r.url)}" style="color:#1367d6;font-size:11px">FDA 원문</a></div>
  </td></tr>`;
}

function section(title, rows, note) {
  if (!rows.length) return "";
  return `<h2 style="${F.h2}">${esc(title)} <span style="color:#78889a;font-weight:normal;font-size:12px">${
    rows.length
  }건</span></h2>
  ${note ? `<div style="color:#78889a;font-size:12px;margin:0 0 8px">${esc(note)}</div>` : ""}
  <table style="${F.tbl}"><thead><tr>
    <th style="${F.th}">게시일</th><th style="${F.th}">회사</th><th style="${F.th}">요약 · 지적사항</th>
  </tr></thead><tbody>${rows.map(rowsFor).join("")}</tbody></table>`;
}

const html = `<div style="${F.wrap}">
<div style="font-size:17px;font-weight:bold;margin-bottom:4px">FDA Warning Letter — 의약품 CGMP</div>
<div style="color:#78889a;font-size:12px;margin-bottom:6px">
  ${esc((cur.generatedAt || "").replace("T", " ").replace("Z", " UTC"))} 기준 ·
  전체 ${(cur.total || 0).toLocaleString()}건 (요약 대기 ${cur.pending || 0}건)
</div>
${section("신규 warning letter", fresh)}
${section("요약·지적사항 정리 완료", summarized, "이전 회차에 '요약 대기'로 올렸던 건입니다.")}
${section("Close-out(종결)", closed, "FDA 가 시정 완료를 인정한 건입니다.")}
${section("FDA 목록에서 내려감", gone, "FDA 원문은 사라지지만 대시보드에는 보존본으로 계속 남습니다.")}
<div style="margin-top:24px;font-size:12px">
  <a href="${SITE}/" style="color:#1367d6;font-weight:bold">대시보드 열기 →</a>
</div>
<div style="margin-top:14px;color:#78889a;font-size:11px;line-height:1.7">
  한국어 요약·지적사항 정리는 FDA 영문 원문을 자동 정리한 것입니다. 정확한 내용은 FDA 원문을 확인하세요.<br>
  FDA 공개 데이터를 정리한 참고용이며 공식 자료가 아닙니다.
</div>
</div>`;

fs.writeFileSync(path.join(ROOT, "email-body.html"), html);

const bits = [];
if (fresh.length) bits.push(`신규 ${fresh.length}건`);
if (summarized.length) bits.push(`요약완료 ${summarized.length}건`);
if (closed.length) bits.push(`종결 ${closed.length}건`);
if (gone.length) bits.push(`목록삭제 ${gone.length}건`);
const lead = fresh[0] ? ` — ${fresh[0].company}${fresh.length > 1 ? ` 외 ${fresh.length - 1}곳` : ""}` : "";
const subject = `[FDA Warning Letter] ${bits.join(" · ")}${lead}`;

emitOutput({ send: "true", subject, to: recipients.join(",") });
console.log(`SEND=true ${bits.join(" ")} TO=${recipients.join(",")}`);

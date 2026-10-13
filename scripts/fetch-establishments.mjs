// FDA 에 등록된 의약품 제조소 목록(DECRS) → public/establishments.json
//
//   node scripts/fetch-establishments.mjs
//
// 출처: Drug Establishments Current Registration Site (DECRS)
//   https://www.fda.gov/drugs/drug-approvals-and-databases/drug-establishments-current-registration-site-decrs
//   다운로드 https://www.accessdata.fda.gov/cder/drls_reg.zip (탭 구분 txt + xls, 매 영업일 갱신)
//   제외 목록 https://www.accessdata.fda.gov/cder/drls_excluded.zip (EXCLUSION_FLAG=E, 사유는 FDA 가 밝히지 않음)
//
// ★ accessdata.fda.gov 는 www.fda.gov 와 달리 Akamai 봇탐지가 없다(2026-10-13 실측, 평범한 UA 로 200).
// ★ 원본에는 담당자 이름·이메일·전화가 들어 있다. FDA 공개 자료이긴 하지만 공개 대시보드에
//   개인 연락처를 다시 뿌릴 이유가 없으므로 **회사·주소·업무·만료일만** 싣는다.
// ★ 인코딩이 섞여 있다 — 대부분 UTF-8 인데 일부 행(약 380행)이 Windows-1252 다. 행 단위로 판별한다.
// ★ FDA 파일은 '현재 등록된' 곳만 담는다. 만료·말소·FDA 비활성화(집행조치)된 곳은 **예고 없이 빠진다.**
//   그래서 이전 회차에 있었는데 이번에 없는 곳은 `removed` 로 옮겨 REMOVED_KEEP_DAYS 동안 보여준다
//   (해마다 12-31 만료분이 1월에 대거 빠지므로 무기한 보관하지는 않는다).
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { ROOT } from "./fda-common.mjs";

const REG_URL = "https://www.accessdata.fda.gov/cder/drls_reg.zip";
const EXC_URL = "https://www.accessdata.fda.gov/cder/drls_excluded.zip";
const OUT = path.join(ROOT, "public", "establishments.json");
const REMOVED_KEEP_DAYS = 400;
// 정상 파일은 1만 건 남짓. 이보다 확 적으면 FDA 쪽 반쪽짜리 파일로 보고 덮어쓰지 않는다
// (덮어쓰면 수천 곳이 한꺼번에 '등록 해제'로 잘못 표시된다).
const MIN_ROWS = 5000;

const today = () => new Date().toISOString().slice(0, 10);
const readJson = (p, dflt = null) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return dflt;
  }
};

async function download(url) {
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36" },
      });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
  throw new Error(`${url} 다운로드 실패 — ${last && last.message}`);
}

/** zip 에서 이름이 `name` 인 파일 하나를 꺼낸다(중앙 디렉터리 기준, stored/deflate 만). */
function unzipOne(buf, name) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip 형식이 아님");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const fname = buf.toString("latin1", p + 46, p + 46 + nlen);
    if (fname.toLowerCase() === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`지원하지 않는 압축 방식 ${method}`);
    }
    p += 46 + nlen + elen + clen;
  }
  throw new Error(`zip 안에 ${name} 이 없음`);
}

const utf8 = new TextDecoder("utf-8", { fatal: true });
const cp1252 = new TextDecoder("windows-1252");
/** 행 단위로 UTF-8 → 실패하면 Windows-1252. */
function decodeLines(buf) {
  const out = [];
  let s = 0;
  for (let i = 0; i <= buf.length; i++) {
    if (i === buf.length || buf[i] === 0x0a) {
      const line = buf.subarray(s, i);
      let t;
      try {
        t = utf8.decode(line);
      } catch {
        t = cp1252.decode(line);
      }
      out.push(t.replace(/\r$/, ""));
      s = i + 1;
    }
  }
  return out;
}

// 원본 국가명이 Warning Letter 쪽 표기와 다른 것만 맞춘다(국가 필터·교차 조회가 같은 이름을 쓰게).
const COUNTRY_ALIAS = {
  KOR: "South Korea", PRK: "North Korea", TWN: "Taiwan", USA: "United States", GBR: "United Kingdom",
  CZE: "Czechia", VNM: "Vietnam", TUR: "Turkey", RUS: "Russia", IRN: "Iran", HKG: "Hong Kong",
};

/** "..., Gifu 509-4241, Japan (JPN)" → { cc:"JPN", country:"Japan", state } */
function parseCountry(addr) {
  const m = addr.match(/,\s*([^,]+?)\s*\((\w{3})\)\s*$/);
  if (!m) return { cc: "", country: "", state: "" };
  const cc = m[2];
  let name = m[1];
  // "Korea, South (KOR)" 처럼 국가명 안에 쉼표가 있는 경우
  const m2 = addr.match(/,\s*([^,]+,\s*[^,]+?)\s*\((\w{3})\)\s*$/);
  if (m2 && /^(Korea|Congo|Micronesia|Bahamas|Gambia)\b/.test(m2[1])) name = m2[1];
  // 미국 주소는 "Boise, Idaho (ID), United States (USA)"
  const st = cc === "USA" ? (addr.match(/\((\w{2})\),\s*United States/) || [])[1] || "" : "";
  return { cc, country: COUNTRY_ALIAS[cc] || name, state: st };
}

const MDY = (s) => {
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
};
const stripFei = (s) => String(s || "").replace(/^0+/, "");

/** 탭 구분 본문 → 레코드 배열. 머리행 이름으로 열을 찾는다(열 순서가 바뀌어도 버티게). */
function parse(buf) {
  const lines = decodeLines(buf).filter((l) => l.trim());
  const head = lines[0].split("\t").map((h) => h.trim());
  const col = (n) => {
    const i = head.indexOf(n);
    if (i < 0) throw new Error(`DECRS 머리행에 ${n} 열이 없음 — 형식 변경`);
    return i;
  };
  const C = {
    fei: col("FEI_NUMBER"), duns: col("DUNS_NUMBER"), name: col("FIRM_NAME"), addr: col("ADDRESS"),
    exp: col("EXPIRATION_DATE"), ops: col("OPERATIONS"), agent: col("AGENT_DETAILS"),
    reg: col("REGISTRANT_NAME"), regDuns: col("REGISTRANT_DUNS"), excl: col("EXCLUSION_FLAG"),
  };
  return lines.slice(1).map((l) => {
    const c = l.split("\t").map((x) => x.trim());
    const addr = c[C.addr] || "";
    // AGENT_DETAILS = "DUNS - 회사명 - 이메일 - 전화" → 회사명만 (회사명 안에도 " - " 가 있을 수 있다)
    const ap = (c[C.agent] || "").split(" - ");
    const agent = ap.length >= 4 ? ap.slice(1, -2).join(" - ") : "";
    const name = c[C.name] || "";
    const reg = c[C.reg] || "";
    return {
      duns: c[C.duns] || "",
      fei: stripFei(c[C.fei]),
      name,
      addr,
      ...parseCountry(addr),
      exp: MDY(c[C.exp]),
      ops: (c[C.ops] || "").split(";").map((s) => s.trim()).filter(Boolean),
      reg: reg && reg !== name ? reg : "",
      regDuns: c[C.regDuns] || "",
      agent,
      excluded: (c[C.excl] || "") === "E",
    };
  }).filter((r) => r.duns);
}

async function main() {
  const reg = parse(unzipOne(await download(REG_URL), "drls_reg.txt"));
  if (reg.length < MIN_ROWS) throw new Error(`등록 목록이 ${reg.length}건뿐 — FDA 파일 이상으로 보고 덮어쓰지 않음`);
  let exc = [];
  try {
    exc = parse(unzipOne(await download(EXC_URL), "drls_excluded.txt"));
  } catch (e) {
    console.error(`  · 제외 목록 취득 실패(등록 목록만 반영) — ${e.message}`);
  }

  const prev = readJson(OUT, { records: [], removed: [] });
  const firstRun = !prev.records.length;
  const seen = new Map(prev.records.map((r) => [r.duns, r.firstSeen]));
  const d = today();

  const records = reg.map((r) => ({ ...r, excluded: undefined, firstSeen: seen.has(r.duns) ? seen.get(r.duns) : firstRun ? "" : d }));
  const nowKeys = new Set(records.map((r) => r.duns));

  // 이번에 빠진 곳 → removed. 다시 등록되면 removed 에서 지운다.
  const cutoff = new Date(Date.now() - REMOVED_KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  const removed = new Map();
  for (const r of prev.removed || []) if (!nowKeys.has(r.duns) && r.removedSince >= cutoff) removed.set(r.duns, r);
  let newlyRemoved = 0;
  for (const r of prev.records) {
    if (nowKeys.has(r.duns) || removed.has(r.duns)) continue;
    removed.set(r.duns, { ...r, removedSince: d });
    newlyRemoved++;
  }
  const added = firstRun ? 0 : records.filter((r) => r.firstSeen === d).length;

  const out = {
    generatedAt: new Date().toISOString().slice(0, 19) + "Z",
    source: "FDA Drug Establishments Current Registration Site (DECRS)",
    sourceUrl: "https://www.fda.gov/drugs/drug-approvals-and-databases/drug-establishments-current-registration-site-decrs",
    baseline: prev.baseline || d, // 추적 시작일 — 이 날짜 이전 등록분은 '신규' 여부를 알 수 없다
    total: records.length,
    records: records.sort((a, b) => a.name.localeCompare(b.name) || a.duns.localeCompare(b.duns)),
    removed: [...removed.values()].sort((a, b) => b.removedSince.localeCompare(a.removedSince)),
    excluded: exc.map((r) => ({ duns: r.duns, fei: r.fei, name: r.name, addr: r.addr, cc: r.cc, country: r.country, state: r.state })),
  };

  // 내용이 같으면 generatedAt 만 바뀐 파일로 커밋이 쌓이지 않게 쓰지 않는다.
  const body = (o) => JSON.stringify({ ...o, generatedAt: "" });
  if (prev.records.length && body(prev) === body(out)) {
    console.log(`ESTAB=${out.total}\nADDED=0\nREMOVED=0\nCHANGED=0`);
    return;
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`ESTAB=${out.total}\nADDED=${added}\nREMOVED=${newlyRemoved}\nCHANGED=1`);
}

main().catch((e) => {
  console.error(`!! 등록 제조소 갱신 실패 — ${e.message}`);
  // 등록 제조소 수집이 죽어도 warning letter 갱신은 계속돼야 하므로 종료코드는 0, 결과로만 알린다.
  console.log("ESTAB=0\nADDED=0\nREMOVED=0\nCHANGED=0\nFAILED=1");
});

// FDA warning letter 수집 공통 모듈 — HTTP 취득 / 목록 파싱 / 본문 파싱.
//
// ★ FDA(www.fda.gov)는 Akamai 봇탐지를 쓴다. 평범한 UA 나 curl 기본 헤더로는
//   302 → /apology_objects/excessive-requests-apology.html 로 튕긴다(HTTP 200 이 아니라
//   302 라서 조용히 실패하기 쉽다). 브라우저 헤더 풀세트를 보내고, 요청 간격을 두어야 한다.
//   실측(2026-09-11): 헤더 풀세트 + 3초 간격이면 안정. 1초 이하로 몰아치면 수십 건 뒤 차단되고
//   차단은 수십 초~수 분 지속된다. 차단당하면 지수 백오프로 기다린다.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dir, "..");

export const FDA = "https://www.fda.gov";
export const LIST_PAGE =
  "/inspections-compliance-enforcement-and-criminal-investigations/compliance-actions-and-activities/warning-letters";

// 목록은 Drupal views AJAX(POST /views/ajax)로 받는다. DataTables 서버사이드라서
// `start`/`length` 가 먹는다(`page` 는 무시된다 — 실측). length=300 까지 확인됨.
const VIEW = {
  view_name: "warning_letter_solr_index",
  view_display_id: "warning_letter_solr_block",
  view_args: "",
  view_path: "/node/360089",
  view_base_path:
    "inspections-compliance-enforcement-and-criminal-investigations/compliance-actions-and-activities/warning-letters/datatables-data",
  view_dom_id: "2e2d2c381ef0abd5df20f7cf2d8ac139acea1e178514f1f7bb44d25e2a7e0dba",
  pager_element: "0",
  _drupal_ajax: "1",
};

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  "sec-ch-ua": '"Chromium";v="139", "Not;A=Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 봇탐지에 걸린 응답인지 — 302 로 apology 페이지로 보내거나 그 본문이 온 경우. */
function isBlocked(res, body) {
  if (res.status === 302 || res.status === 403 || res.status === 429) return true;
  return /apology_objects|FDA Apology|excessive-requests/.test(body.slice(0, 800));
}

/**
 * FDA 요청 한 번. 봇탐지에 걸리면 지수 백오프로 재시도한다.
 * @returns {Promise<{ok:boolean, body:string, status:number}>}
 */
async function fdaFetch(url, init = {}, { tries = 5, gap = 3000 } = {}) {
  let wait = 15000;
  for (let i = 1; i <= tries; i++) {
    let res, body;
    try {
      res = await fetch(url, { ...init, redirect: "manual", headers: { ...BROWSER_HEADERS, ...(init.headers || {}) } });
      body = await res.text();
    } catch (e) {
      if (i === tries) return { ok: false, body: String(e), status: 0 };
      await sleep(wait);
      wait *= 2;
      continue;
    }
    if (!isBlocked(res, body)) return { ok: res.status === 200, body, status: res.status };
    if (i === tries) return { ok: false, body, status: res.status };
    console.error(`  · FDA 봇탐지(status ${res.status}) — ${Math.round(wait / 1000)}초 대기 후 재시도 ${i}/${tries}`);
    await sleep(wait);
    wait *= 2;
  }
  return { ok: false, body: "", status: 0 };
}

/** 목록 한 페이지(start~start+length). 실패 시 null. */
export async function fetchListPage(start, length) {
  const form = new URLSearchParams({ ...VIEW, draw: "1", start: String(start), length: String(length) });
  const r = await fdaFetch(`${FDA}/views/ajax`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: FDA + LIST_PAGE,
    },
    body: form.toString(),
  });
  if (!r.ok) return null;
  let cmds;
  try {
    cmds = JSON.parse(r.body);
  } catch {
    return null;
  }
  const ins = (Array.isArray(cmds) ? cmds : []).find((c) => c.command === "insert" && c.data && c.data.length > 500);
  if (!ins) return null;
  return parseListHtml(ins.data);
}

const strip = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** 목록 표 HTML → 레코드 배열. 열 순서가 바뀌면 빈 배열이 아니라 throw 한다. */
export function parseListHtml(html) {
  const head = html.slice(0, html.indexOf("<tbody>"));
  // 열 구조 변경 감시 — 헤더 텍스트가 예상과 다르면 파서를 믿으면 안 된다.
  for (const expect of ["Posted Date", "Letter Issue Date", "Company Name"]) {
    if (!head.includes(expect)) throw new Error(`목록 표 구조 변경 의심: 헤더에 '${expect}' 없음`);
  }
  const tbody = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
  const out = [];
  for (const row of tbody.split("<tr>").slice(1)) {
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (tds.length < 7) continue;
    const href = (row.match(/href="([^"]+warning-letters\/[^"]+)"/) || [])[1] || "";
    if (!href) continue;
    out.push({
      id: href.split("/").pop(),
      url: href.startsWith("http") ? href : FDA + href,
      postedDate: usDate(strip(tds[0])),
      letterDate: usDate(strip(tds[1])),
      company: strip(tds[2]),
      office: strip(tds[3]),
      subject: strip(tds[4]),
      responseDate: usDate(strip(tds[5])),
      closeoutDate: usDate(strip(tds[6])),
    });
  }
  return out;
}

/** "06/15/2026" → "2026-06-15". 빈 값은 "". */
export function usDate(s) {
  const m = (s || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
}

/** 편지 상세 페이지 원문 HTML. 실패 시 null. */
export async function fetchLetterHtml(url) {
  const r = await fdaFetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      Referer: FDA + LIST_PAGE,
    },
  });
  return r.ok ? r.body : null;
}

/**
 * 편지 상세 HTML → { text, meta }.
 * text 는 <main> 안의 순수 텍스트(LLM 입력·보존본용), meta 는 머리말에서 규칙 기반으로 뽑은 필드.
 */
export function parseLetter(html) {
  const clean = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
  const main = clean.match(/<main[\s\S]*?<\/main>/);
  if (!main) throw new Error("<main> 영역을 찾을 수 없음 (페이지 구조 변경 의심)");
  // 블록 태그를 줄바꿈으로 바꿔 문단 구분을 살린다 — 지적사항 번호 매김을 보존해야 한다.
  const text = strip(
    main[0].replace(/<\/(p|div|li|h[1-6]|tr|td|br)>/g, "\n").replace(/<br\s*\/?>/g, "\n")
  );
  const textNl = main[0]
    .replace(/<\/(p|div|li|h[1-6]|tr|td)>/g, "\n")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l)
    .join("\n");

  // 머리말은 라벨과 값이 각각 한 줄씩 나오는 정의목록이다. 한 줄로 눌러 붙인 text 에
  // 정규식을 거는 것보다 **라벨 다음 줄을 집는 편이 훨씬 안정적**이다(주소가 여러 줄이라
  // 한 줄 정규식으로는 title 이 주소까지 삼킨다 — 실측).
  const lines = textNl.split("\n");
  const idxOf = (label) => lines.findIndex((l) => l === label || l === label + ":");
  const after = (label) => {
    const i = idxOf(label);
    return i >= 0 && i + 1 < lines.length ? lines[i + 1] : "";
  };
  // 수신자 직함 다음 줄부터 'Issuing Office:' 전까지가 회사명+주소.
  // 마지막 줄을 국가로 쓰므로 꼬리에 붙는 것들을 반드시 걷어낸다 — FDA 는 주소 뒤에
  // (b)(6)·(b)(7)(C) 가림표기, 담당자 이메일, 전화번호를 덧붙인다(실측). 그냥 두면
  // 국가가 "Yugandhar@eugiapharma.com" 이나 "(C)" 가 된다.
  const tIdx = idxOf("Recipient Title");
  const oIdx = idxOf("Issuing Office");
  const addrLines =
    tIdx >= 0 && oIdx > tIdx
      ? lines
          .slice(tIdx + 2, oIdx)
          // 가림표기는 한 줄에 여러 개가 쉼표로 붙어 오기도 한다: "(b)(6), (b)(7)(C)"
          .filter((l) => l.replace(/\(b\)\(\d\)(\([A-Za-z]\))?/g, "").replace(/[,\s]/g, "") !== "")
          .filter((l) => !l.includes("@"))
          .filter((l) => !/^\+?[\d\s().\-]{7,}$/.test(l))
      : [];

  const m1 = text.match(/MARCS-CMS\s+(\d+)/);
  const m2 = text.match(/\bFEI\)?\s*(\d{7,})/);
  const m3 = text.match(/Content current as of:\s*(\d{2}\/\d{2}\/\d{4})/);
  const meta = {
    marcsCms: m1 ? m1[1] : "",
    referenceNo: after("Reference #"),
    product: after("Product"),
    recipientName: after("Recipient Name"),
    recipientTitle: after("Recipient Title"),
    address: addrLines.join(", "),
    country: addrLines.length ? addrLines[addrLines.length - 1] : "",
    issuingOffice: after("Issuing Office"),
    fei: m2 ? m2[1] : "",
    deliveryMethod: after("Delivery Method"),
    contentCurrentAsOf: usDate(m3 ? m3[1] : ""),
  };
  return { text: textNl, meta };
}

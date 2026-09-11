// 로컬 작업 스케줄러 진입점 — 목록 재조회 → 신규 본문 수집 → 요약·지적사항 추출 → merge → push.
//
//   node scripts/run-local-update.mjs
//   DRY_RUN=1 node scripts/run-local-update.mjs   커밋·푸시 없이 리허설
//
// 설계 원칙 (nedrug-gmp 에서 겪은 사고들을 그대로 반영했다)
//  ① **보존본을 먼저 커밋·푸시한다.** FDA 는 warning letter 를 일정 기간 뒤 내린다.
//     추출 단계에서 죽어도 원문 스냅샷은 이미 저장소에 들어가 있어야 한다.
//  ② **부분 반영을 숨기지 않는다.** 추출이 안 된 건은 merge 가 '요약 대기' 로 싣는다 —
//     '지적사항 없음' 으로 뒤바뀌지 않으므로 하드 스톱으로 파이프라인을 잠글 필요가 없다.
//     (nedrug 에서는 하드 스톱이 열리지 않는 1건 때문에 전체 갱신이 14시간 멈춘 적이 있다.)
//  ③ 실패해도 **로그에 흔적을 남긴다.** 로그가 그냥 끊기면 창이 닫혀 죽은 것과 구분되지 않는다.
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { ROOT } from "./fda-common.mjs";

const LOG = path.join(ROOT, "local-update.log");
const DRY = process.env.DRY_RUN === "1";
const IDENT = ["-c", "user.name=fda-wl-bot", "-c", "user.email=fda-wl-bot@local"];

function log(msg) {
  const line = `[${new Date().toISOString().slice(0, 19)}Z] ${msg}`;
  console.error(line);
  try {
    fs.appendFileSync(LOG, line + "\n");
  } catch {}
}
const git = (args, opts = {}) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", ...opts }).trim();
const isRepo = () => {
  try {
    git(["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
};
/** 스크립트를 돌리고 `KEY=값` 형태의 stdout 을 객체로 준다. stderr 는 그대로 흘린다. */
function node(script, env = {}) {
  const out = execFileSync(process.execPath, [script], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
  const kv = {};
  for (const m of out.matchAll(/^([A-Z_]+)=(.*)$/gm)) kv[m[1]] = m[2].trim();
  return kv;
}

function commit(message, paths) {
  if (DRY) {
    log(`[DRY_RUN] commit 생략: ${message}`);
    return false;
  }
  git(["add", ...paths]);
  const staged = git(["diff", "--cached", "--name-only", "--", ...paths]);
  if (!staged) return false;
  git([...IDENT, "commit", "-q", "-m", message, "--", ...paths]);
  return true;
}
function push(label) {
  if (DRY) {
    log(`[DRY_RUN] push 생략 (${label})`);
    return;
  }
  for (let i = 1; i <= 3; i++) {
    try {
      git(["push", "-q", "origin", "HEAD:main"]);
      log(`${label} push 성공 — ${git(["log", "-1", "--oneline"])}`);
      return;
    } catch (e) {
      log(`${label} push 실패 ${i}/3 — ${String(e.message || e).slice(0, 200)}`);
      if (i < 3) {
        try {
          git(["pull", "--rebase", "-q", "origin", "main"]);
        } catch (e2) {
          log(`  pull --rebase 도 실패 — ${String(e2.message || e2).slice(0, 200)}`);
        }
      }
    }
  }
  throw new Error(`${label} push 를 3회 시도 후 포기`);
}

function main() {
  log("=== 갱신 시작 ===");
  const repo = isRepo();
  if (!repo) log("git 저장소가 아님 — 파일만 갱신하고 커밋·푸시는 건너뜁니다.");

  if (repo && !DRY) {
    try {
      git(["pull", "--rebase", "-q", "origin", "main"]);
    } catch (e) {
      log(`pull 실패(계속 진행) — ${String(e.message || e).slice(0, 200)}`);
    }
  }

  const l = node("scripts/fetch-list.mjs");
  log(`목록 ${l.LIST}건`);

  const f = node("scripts/fetch-new.mjs");
  log(`신규 본문 ${f.NEW}건 확보 · 취득 실패 ${f.FAIL}건`);

  // ① 원문 확보가 최우선 — 추출 전에 보존본을 먼저 커밋·푸시한다.
  if (repo && Number(f.NEW) > 0) {
    if (commit(`archive: warning letter 보존본 ${f.NEW}건 추가`, ["public/archive"])) push("보존본");
  }

  const e = node("scripts/extract-local.mjs");
  log(`요약·지적사항 추출 ${e.EXTRACTED}건 · 실패 ${e.FAIL}건`);

  const m = node("scripts/merge.mjs");
  log(`data.json — 총 ${m.TOTAL}건 (요약 대기 ${m.PENDING}건)`);

  if (repo) {
    const parts = [];
    if (Number(f.NEW)) parts.push(`신규 ${f.NEW}건`);
    if (Number(e.EXTRACTED)) parts.push(`요약 ${e.EXTRACTED}건`);
    if (Number(e.FAIL)) parts.push(`추출실패 ${e.FAIL}건`);
    const msg = `data: FDA warning letter 갱신${parts.length ? " — " + parts.join(" · ") : ""}`;
    if (commit(msg, ["public/data.json", "extracted", "newdocs/list.json"])) push("데이터");
    else if (!DRY) log("변경 없음 — 커밋할 것이 없습니다.");
  }
  log("=== 갱신 끝 ===");
}

try {
  main();
} catch (e) {
  log(`!! 중단 — ${String(e.stack || e.message || e).slice(0, 800)}`);
  process.exit(1);
}

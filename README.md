# FDA Warning Letter 대시보드 — 의약품 CGMP

미국 FDA 가 공개하는 [Warning Letters](https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/compliance-actions-and-activities/warning-letters)
중 **의약품(바이오의약품 포함) CGMP 관련 건**만 모아, 영문 원문을 **한국어로 요약**하고
**지적사항별로 표로 정리**해 보여주는 정적 웹 대시보드입니다.

식약처 GMP 실사 결과공개 대시보드(`nedrug-gmp`)와 같은 성격의 자료를 미국 쪽에서 보는 용도입니다.

| | |
|---|---|
| 원본 | FDA Warning Letters (전체 3,679건, 2021-01 ~ ) |
| 담는 범위 | 그중 의약품 CGMP 관련 **512건** (`scripts/scope.mjs` 판정) |
| 대시보드 | `public/index.html` (단일 파일, 외부 의존성 없음) |
| 데이터셋 | `public/data.json` |
| 원문 보존본 | `public/archive/<id>.html` |

## 왜 보존본을 저장소에 넣는가

**FDA 는 일정 기간이 지나면 warning letter 를 목록에서 내립니다.** 그러면 링크도 죽습니다.
그래서 이 저장소는 편지를 처음 볼 때 본문 스냅샷을 `public/archive/` 에 넣고 커밋합니다.
FDA 목록에서 사라진 건은 **삭제하지 않고** `delisted:true` 로 표시해 계속 싣고,
대시보드에서 `목록에서 내려감` 배지와 함께 **보존본 링크**를 제공합니다.

`merge.mjs` 는 여기서 두 가지를 구분합니다.

- **FDA 가 내린 건** — 전체 목록(`newdocs/list.json`)에 아예 없음 → 보존 + `delisted`
- **우리가 범위에서 뺀 건** — 전체 목록에는 있는데 `inScope()` 판정만 바뀜 → 조용히 제외
  (판정을 고칠 때마다 가짜 '내려감' 레코드가 쌓이지 않게)

## 구성

```
public/
  index.html      대시보드 (단일 파일)
  data.json       데이터셋
  archive/*.html  원문 보존본
extracted/*.json  ★ 한국어 요약·지적사항의 영구 저장소 (건별 파일)
scripts/
  fda-common.mjs      HTTP 취득 / 목록·본문 파싱
  scope.mjs           '의약품 CGMP 건' 판정 + 분류
  fetch-list.mjs      목록 전량 재조회            → newdocs/list.json
  fetch-new.mjs       신규 건 본문 수집·보존본 저장 → public/archive, newdocs/<id>.txt
  extract-local.mjs   한국어 요약·지적사항 추출     → extracted/<id>.json
  rebuild-meta.mjs    보존본에서 머리말 재파싱 (FDA 재조회 없이)
  merge.mjs           위 셋을 합쳐              → public/data.json
  build-email.mjs     신규·변경 알림 메일 본문
  run-local-update.mjs 로컬 스케줄러 진입점
  serve.mjs           로컬 정적 서버 (개발용)
recipients.json   알림 메일 수신자
```

`extracted/` 가 **영구 저장소**입니다. 건별 파일이라 512건 소급 추출이 중간에 끊겨도 이어받고,
`public/data.json` 은 여기서 언제든 다시 만들 수 있습니다(`node scripts/merge.mjs`).

## 갱신 파이프라인

```bash
node scripts/fetch-list.mjs      # 목록 전량 (13페이지 × 300건)
node scripts/fetch-new.mjs       # 범위 내 미확보 건의 본문 + 보존본
node scripts/extract-local.mjs   # 한국어 요약 + 지적사항 (claude CLI)
node scripts/merge.mjs           # public/data.json
```

한 번에: `node scripts/run-local-update.mjs` (`DRY_RUN=1` 로 커밋·푸시 없이 리허설)

### 한국어 요약·지적사항 추출

`extract-local.mjs` 가 편지 1건당 **로컬 Claude Code CLI(`claude -p`)** 를 1회 호출합니다.
유료 API 키 대신 기존 구독으로 처리되므로 API 비용이 없습니다(회사 정책상 API 키 발급이 어려움).

산출 스키마는 `extract-local.mjs` 의 `INSTRUCTION` 에 있습니다. 요지:

| 필드 | 내용 |
|---|---|
| `headlineKo` | 표 한 줄용 한국어 한 줄 요약 |
| `summaryKo` | 한국어 3~4문장 요약 (실사 시기·지적 건수·회사 답변 평가·FDA 조치) |
| `violations[]` | 번호 매겨진 위반 항목별로 `area`(분야) · `cfr`(근거 조항) · `titleKo` · `detailKo` · `responseKo`(회사 답변에 대한 FDA 평가) · `dataIntegrity` |
| `flags` | 수입경보 · 리콜권고 · 제조중단 · 실사거부 · 컨설턴트 권고 |
| `inspectionStart/End`, `facility`, `form483ResponseDate`, `keywordsKo` | |

번역 규칙:
- 요약·지적 내용은 **한국어**, 숫자·날짜는 원문 그대로 (사실관계 변경 금지)
- **근거 조항(`21 CFR 211.194(a)` 등)과 회사명·시설 주소는 영문 유지** — 번역하면 원문 대조가 안 됨
- FDA 가 가린 `(b)(4)` 는 추측하지 않고 `(비공개)` 로 표기
- `In response to this letter, provide:` 뒤의 FDA 요구사항 목록은 지적사항이 아니므로 별도 항목으로 만들지 않음

`area` 는 고정 목록(품질시스템 / 문서·데이터완전성 / 시험·QC / 제조·공정관리 / 무균·멸균 /
시설·장비 / 원자재·공급자 / 허가·표시 / 기타)이어야 합니다 — 모델이 자유롭게 만들면 필터가 무의미해집니다.

### 사용량 한도 — 소급 추출은 여러 회차에 걸쳐 스스로 채워진다

512건 소급 추출은 한 번에 끝나지 않습니다. Claude 사용량 한도에 걸리면 **모든 호출이 즉시
종료코드 1** 로 떨어지는데, 그대로 두면 몇 초 만에 남은 수백 건이 전부 '실패'로 기록됩니다
(실측: 179건이 한꺼번에 탔습니다).

그래서 `extract-local.mjs` 에 **연속 실패 차단기**가 있습니다(`HALT_AFTER`, 기본 5).
연속 5건이 실패하면 남은 건을 건드리지 않고 멈추고 `HALTED=1` 을 출력합니다.
건별 파일이 저장소이므로 **다음 회차가 그대로 이어받습니다** — 그래서 종료코드는 0 입니다(실패가 아님).

작업 스케줄러가 4시간마다 도는 것도 이 때문입니다. 한도가 풀리는 주기에 맞춰 회차마다
50건 안팎씩 이어받아, 며칠에 걸쳐 소급분이 소진됩니다. 그동안 미추출 건은 아래처럼 표시됩니다.

### 요약이 안 된 건을 '지적사항 없음'으로 만들지 않는다

warning letter 는 본래 위반을 적는 문서라 **지적 0건은 거의 항상 판독 실패**입니다.
그래서 추출되지 않은 건은 `status:"요약 대기"` + `defCount:null` 로 싣고, 집계에서 빼고,
대시보드에도 `요약 대기` 배지와 "지적사항이 없다는 뜻이 아닙니다" 안내를 띄웁니다.

이 표현 덕분에 **하드 스톱이 필요 없습니다.** (`nedrug-gmp` 에서는 부분 반영을 막으려 하드 스톱을
걸었는데, 열리지 않는 1건 때문에 전체 갱신이 14시간 멈춘 적이 있습니다.)

## FDA 접속 — 봇탐지 주의

`www.fda.gov` 는 Akamai 봇탐지를 씁니다. 평범한 UA 나 curl 기본 헤더로는
**HTTP 302 → `/apology_objects/excessive-requests-apology.html`** 로 튕깁니다.
200 이 아니라 302 라서 조용히 실패하기 쉽습니다.

- `fda-common.mjs` 가 브라우저 헤더 풀세트를 보내고, 302/apology 응답을 **차단으로 판정**해
  지수 백오프(15초 → 30초 → …)로 재시도합니다.
- 요청 간격은 기본 **3초**(`GAP_MS`). 1초 이하로 몰아치면 수십 건 뒤 차단되고 수십 초~수 분 지속됩니다.
- `/datatables/views/ajax` 경로는 헤더를 맞춰도 차단됩니다. 목록은 **`POST /views/ajax`** 로 받습니다
  (`page` 파라미터는 무시되고 **`start`/`length`** 가 먹습니다. `length=300` 까지 확인).
- `.../warning-letters/datatables-data?_format=xlsx` 로 엑셀 내보내기도 되지만
  **1,000건 상한이고 편지 URL 이 없어** 쓰지 않습니다.

## 목록 파싱 함정

- 목록 표의 **열 순서가 바뀌면 빈 배열이 아니라 throw** 합니다(`parseListHtml`) — 조용히 0건이
  되는 게 최악입니다.
- 상세 머리말은 `라벨 / 값` 이 각각 한 줄인 정의목록입니다. **한 줄로 눌러 붙여 정규식을 걸지 말고
  라벨 다음 줄을 집으세요.** 주소가 여러 줄이라 한 줄 정규식으로는 직함이 주소까지 삼킵니다.
- 주소 블록 꼬리에 FDA 가 **`(b)(6)`·`(b)(7)(C)` 가림표기, 담당자 이메일, 전화번호**를 덧붙입니다.
  걷어내지 않으면 국가가 `Yugandhar@eugiapharma.com` 이나 `(C)` 가 됩니다.
- 범위 판정에서 **의료기기 판정이 의약품 판정보다 먼저** 와야 합니다. `CGMP/QSR/Drug/Medical
  Devices/Adulterated` 는 'Drug' 를 품고 있어서, 의약품 판정을 앞세우면 발판 스위치 제조사(CDRH 발행)
  같은 기기 전용 건이 통과합니다.
- 파서를 고쳤으면 **`rebuild-meta.mjs` 로 보존본에서 다시 뽑으세요.** FDA 를 재조회하지 않습니다.

## 자동화

수집은 **로컬 작업 스케줄러 단독**입니다. 클라우드(GitHub Actions)에서 수집하지 않는 이유:

1. FDA 봇탐지가 데이터센터 IP 를 더 세게 막습니다.
2. 한국어 요약은 로컬 `claude` CLI 가 필요합니다.
3. 수집기가 둘이면 같은 보존본 파일을 각자 받아 `git pull` 이 막히는 사고가 납니다(`nedrug-gmp` 경험).

```
작업 이름: FdaWarningLetters
동작:      wscript //nologo <경로>\run-hidden.vbs
트리거:    4시간마다 + 로그온 시 1회, '예약을 놓친 경우 가능한 빨리 시작'(StartWhenAvailable) 켬
```

- **`run-hidden.vbs` 를 통해 실행합니다.** `.cmd` 를 직접 가리키면 콘솔 창이 떠 있고, 추출이 수 분
  걸리는 동안 멈춘 것으로 보여 누가 닫으면 실행이 죽습니다(종료코드 `0xC000013A`).
- 절전으로 지나간 예약은 `StartWhenAvailable` 이 꺼져 있으면 **만회 실행되지 않습니다**(이벤트 153).
- 점검은 **`cmd.exe` 로** 하세요. Git Bash 의 PATH 와 `cmd.exe` 의 PATH 가 다릅니다
  (Git Bash 에서 cmd 를 부를 때는 `cmd //c`, 슬래시 하나면 배너만 찍고 돌지 않습니다).

### 배포·알림

- `.github/workflows/pages.yml` — `public/` 를 GitHub Pages 로 배포 (push 트리거)
- `.github/workflows/notify.yml` — `public/data.json` 이 바뀐 푸시에서만 직전 커밋과 비교해
  **신규 · 요약완료 · 종결(Close-out) · 목록삭제** 건을 메일로 보냄. 수신자 `recipients.json`
  (Gmail SMTP — `MAIL_USERNAME` / `MAIL_PASSWORD` 시크릿 필요)
- 수신자가 비면 **빨간불로 실패**시킵니다. 조용히 성공으로 끝내면 알림이 영구히 안 가는데 아무도 모릅니다.

## 로컬 실행

```bash
npm run serve   # http://localhost:8788
```

대시보드는 해시로 화면 상태를 공유할 수 있습니다.

```
#view=def&area=문서·데이터완전성&country=India   지적사항별 보기 + 필터
#id=<letter-id>                                 특정 편지를 펼친 채로 열기
```

## 주의

- 한국어 요약·지적사항 정리는 FDA 영문 원문을 자동 정리한 것입니다. 정확한 내용은 각 행의
  **FDA 원문**(또는 보존본)을 확인하세요.
- 본 저장소는 FDA 공개 데이터를 정리한 **참고용**이며 공식 자료가 아닙니다.

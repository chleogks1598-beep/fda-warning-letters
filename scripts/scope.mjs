// 대시보드가 다루는 범위 판정 — **의약품(바이오의약품 포함) CGMP 제조소 건**만 담는다.
//
// FDA warning letter 는 담배(1,206건)·식품·수입식품(FSVP)·의료기기까지 한 목록에 섞여 있어
// 전량(3,679건, 2021-01~)을 그대로 담으면 제조소 GMP 신호가 묻힌다. 식약처 GMP 실사결과
// 대시보드와 같은 성격 — 즉 **실사에서 나온 지적사항** — 만 남기기 위해 subject 로 1차 판정한다.
//
// subject 는 FDA 가 목록에 붙이는 분류 문자열이다(예 "CGMP/Finished Pharmaceuticals/Adulterated").
// 규칙 기반으로 충분히 갈리지만, 애매한 소수는 발행 부서(office)로 판정한다.

/** 의약품·바이오의약품 담당 부서인가. */
export function isDrugOffice(office = "") {
  return /Drug Evaluation and Research|CDER|Pharmaceutical Quality|Manufacturing Quality|Biological Products Operations|Biologics Evaluation|CBER/i.test(
    office
  );
}

const DRUGISH =
  /Pharmaceutical|\bDrugs?\b|Active Pharmaceutical Ingredient|\bAPI\b|Positron Emission Tomography|Biologics License Application|\bBLA\b|Blood & Blood Components|Human Cells, Tissues|HCT\/Ps|Compounding/i;

// 같은 'CGMP' 를 쓰지만 의약품이 아닌 규제 영역들.
const NONDRUG =
  /\bFoods?\b|Seafood|Juice|Dietary Supplement|Medicated Feeds?|Non-Medicated Feed|Bottled Drinking Water|Infant Formula|Cosmetic|Tobacco|Animal Food|for Animals/i;

const DEVICE = /Medical Devices?|\bQSR\b/i;

/**
 * 목록 레코드 한 건이 범위에 드는가.
 * @param {{subject?:string, office?:string}} r
 */
export function inScope(r) {
  const subject = r.subject || "";
  const office = r.office || "";
  if (!/CGMP/i.test(subject)) return false;
  const drug = DRUGISH.test(subject);
  if (NONDRUG.test(subject)) return false;
  // ★ 의료기기 판정이 의약품 판정보다 **먼저** 와야 한다. "CGMP/QSR/Drug/Medical Devices/
  //   Adulterated" 는 'Drug' 를 품고 있어서 의약품 판정만 앞세우면 발판 스위치 제조사(CDRH 발행)
  //   같은 기기 전용 건이 통과한다(실측 2건). 의약품 표현 + 의약품 담당 부서 발행을 모두
  //   만족할 때만 남긴다(= 의약품-기기 복합제 건).
  if (DEVICE.test(subject)) return drug && isDrugOffice(office);
  if (drug) return true;
  // 남은 애매한 소수(예 "CGMP Deviations")는 발행 부서로 판정한다.
  return isDrugOffice(office);
}

/** subject 를 대시보드 필터용 대분류로 접는다. */
export function category(subject = "") {
  if (/Active Pharmaceutical Ingredient|\bAPI\b/i.test(subject)) return "원료의약품(API)";
  if (/Compounding/i.test(subject)) return "조제약국(Compounding)";
  if (/Positron Emission/i.test(subject)) return "방사성의약품(PET)";
  if (/Biologics License Application|\bBLA\b|Blood & Blood Components|Human Cells, Tissues|HCT\/Ps/i.test(subject))
    return "생물학적제제";
  if (/OTC/i.test(subject)) return "OTC 완제";
  if (/Finished Pharmaceutical/i.test(subject)) return "완제의약품";
  return "기타 의약품";
}

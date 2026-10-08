// 기력용 바이오중유 품질규격 비교표 — [품질규격 비교] 탭의 규격·기준을 그대로 옮긴 것.
// criterion: "이상" | "이하" | "범위" | "등급" | "참고"
// combine: 같은 값으로 묶여서 합계로 판정되는 항목(Si+Al+Fe)은 group으로 표시

export interface SpecItem {
  key: string;
  item: string;        // 항목
  abbr: string;         // 구분 (영문 약어)
  specLabel: string;    // 품질규격 표시 텍스트
  low?: number;
  high?: number;
  criterion: "이상" | "이하" | "범위" | "등급" | "참고";
  method: string;       // 분석방법
  recommend?: string;   // 부적합 시 권장 공정
  group?: "si_al_fe";   // Si+Al+Fe 합계 200 이하로 함께 판정되는 그룹
}

export const COPPER_GRADES = ["1a", "1b", "1c", "2a", "2b", "2c", "3"];

export const SPEC_ITEMS: SpecItem[] = [
  { key: "flash_point", item: "인화점(℃)", abbr: "Flash Point", specLabel: "80 이상", low: 80, criterion: "이상", method: "KS M ISO 2719", recommend: "블렌딩·원료교체" },
  { key: "viscosity", item: "동점도(50℃, mm²/s)", abbr: "Viscosity", specLabel: "15 이상 ~ 55 이하", low: 15, high: 55, criterion: "범위", method: "KS M ISO 3104", recommend: "블렌딩·원료교체" },
  { key: "residual_carbon", item: "잔류탄소분(무게%)", abbr: "Residual Carbon", specLabel: "5 이하", high: 5, criterion: "이하", method: "KS M ISO 10370", recommend: "탈검" },
  { key: "s", item: "황분(무게%)", abbr: "S", specLabel: "0.05 이하", high: 0.05, criterion: "이하", method: "KS M ISO 8754", recommend: "블렌딩·원료교체" },
  { key: "ash", item: "회분(무게%)", abbr: "Ash", specLabel: "0.10 이하", high: 0.1, criterion: "이하", method: "KS M ISO 6245", recommend: "탈검" },
  { key: "copper_corrosion", item: "동판부식(50℃,3h)", abbr: "Copper Corrosion", specLabel: "1b 이하", high: 2, criterion: "등급", method: "KS M ISO 2160", recommend: "탈검" },
  { key: "pour_point", item: "유동점(℃)", abbr: "Pour Point", specLabel: "27 이하", high: 27, criterion: "이하", method: "KS M ISO 3016", recommend: "블렌딩·원료교체" },
  { key: "density", item: "밀도(15℃, kg/㎥)", abbr: "Density", specLabel: "991 이하", high: 991, criterion: "이하", method: "KS M ISO 12185", recommend: "블렌딩·원료교체" },
  { key: "water", item: "수분(무게%)", abbr: "Water", specLabel: "0.20 이하", high: 0.2, criterion: "이하", method: "KS M 0010", recommend: "탈수" },
  { key: "av", item: "전산가(mg KOH/g)", abbr: "AV", specLabel: "25 이하", high: 25, criterion: "이하", method: "KS M ISO 6618", recommend: "탈검" },
  { key: "na", item: "알칼리금속(mg/kg)", abbr: "Na", specLabel: "50 이하", high: 50, criterion: "이하", method: "EN 14108", recommend: "탈검" },
  { key: "ca", item: "알칼리금속(mg/kg)", abbr: "Ca", specLabel: "30 이하", high: 30, criterion: "이하", method: "ASTM D7111", recommend: "탈검" },
  { key: "k", item: "알칼리금속(mg/kg)", abbr: "K", specLabel: "50 이하", high: 50, criterion: "이하", method: "EN 14109", recommend: "탈검" },
  { key: "iv", item: "요오드가(g/100g)", abbr: "IV", specLabel: "120 이하", high: 120, criterion: "이하", method: "KS M 0065", recommend: "블렌딩·원료교체" },
  { key: "n", item: "질소(무게%)", abbr: "N", specLabel: "0.3 이하", high: 0.3, criterion: "이하", method: "KS M 2112", recommend: "블렌딩·원료교체" },
  { key: "v", item: "바나듐(mg/kg)", abbr: "V", specLabel: "50 이하", high: 50, criterion: "이하", method: "ASTM D7111", recommend: "탈검" },
  { key: "energy_content", item: "고위발열량(kcal/kg)", abbr: "Energy Content", specLabel: "9,200 이상", low: 9200, criterion: "이상", method: "KS M 2057", recommend: "블렌딩·원료교체" },
  { key: "net_calorific", item: "저위발열량(kcal/kg)", abbr: "Net Calorific Value", specLabel: "8,600 이상", low: 8600, criterion: "이상", method: "KS M 2057", recommend: "블렌딩·원료교체" },
  { key: "water_sediments", item: "물과침전물(부피%)", abbr: "Water&Sediments", specLabel: "0.5 이하", high: 0.5, criterion: "이하", method: "KS M ISO 3734", recommend: "탈수" },
  { key: "si", item: "실리콘(mg/kg)", abbr: "Si", specLabel: "Si+Al+Fe 합계 200 이하", high: 200, criterion: "참고", method: "ASTM D7111", recommend: "탈검", group: "si_al_fe" },
  { key: "al", item: "알루미늄(mg/kg)", abbr: "Al", specLabel: "Si+Al+Fe 합계 200 이하", high: 200, criterion: "참고", method: "ASTM D7111", group: "si_al_fe" },
  { key: "fe", item: "철(mg/kg)", abbr: "Fe", specLabel: "Si+Al+Fe 합계 200 이하", high: 200, criterion: "참고", method: "ASTM D7111", group: "si_al_fe" },
  { key: "p", item: "인(mg/kg)", abbr: "P", specLabel: "20 이하", high: 20, criterion: "이하", method: "ASTM D7111", recommend: "탈검" },
  { key: "hg", item: "수은(mg/kg)", abbr: "Hg", specLabel: "20 이하", high: 20, criterion: "이하", method: "UOP 938", recommend: "특수처리" },
];

export type Verdict = "적합" | "부적합" | "참고용" | "";

// 항목 하나의 측정값 판정 (Si/Al/Fe 합계 그룹은 judgeGroup으로 별도 처리)
export function judgeItem(spec: SpecItem, value: string | number | undefined): Verdict {
  if (value === undefined || value === null || value === "") return "";
  const v = Number(value);
  if (Number.isNaN(v)) return "";
  if (spec.group) return ""; // 그룹 항목은 judgeGroup으로 판정
  switch (spec.criterion) {
    case "이상": return v >= (spec.low ?? 0) ? "적합" : "부적합";
    case "이하": return v <= (spec.high ?? 0) ? "적합" : "부적합";
    case "범위": return v >= (spec.low ?? -Infinity) && v <= (spec.high ?? Infinity) ? "적합" : "부적합";
    case "등급": {
      const idx = COPPER_GRADES.indexOf(String(value).trim());
      if (idx < 0) return "참고용";
      return idx + 1 <= (spec.high ?? 99) ? "적합" : "부적합";
    }
    default: return "참고용";
  }
}

// Si+Al+Fe 합계 200 이하 그룹 판정
export function judgeSiAlFeGroup(measured: Record<string, any>): Verdict {
  const keys = ["si", "al", "fe"];
  const vals = keys.map((k) => measured[k]).filter((v) => v !== undefined && v !== null && v !== "");
  if (vals.length === 0) return "";
  const sum = vals.reduce((a, b) => a + Number(b), 0);
  return sum <= 200 ? "적합" : "부적합";
}

export function recommendedAction(spec: SpecItem, verdict: Verdict): string {
  if (verdict === "") return "";
  if (verdict === "참고용") return "-";
  if (verdict === "부적합") return `${spec.recommend || "검토"} 필요`;
  return "기준 충족";
}

// 전체 측정값으로 요약(종합판정·부적합 개수) 계산
export function summarize(measured: Record<string, any>) {
  let total = 0, bad = 0;
  const byProcess: Record<string, number> = { "탈수": 0, "탈검": 0, "블렌딩·원료교체": 0, "특수처리": 0 };
  for (const spec of SPEC_ITEMS) {
    if (spec.group && spec.group !== "si_al_fe") continue;
    let verdict: Verdict;
    if (spec.key === "si") verdict = judgeSiAlFeGroup(measured); // si 대표로 그룹 판정 1회만 집계
    else if (spec.group) continue;
    else verdict = judgeItem(spec, measured[spec.key]);
    if (verdict === "" || verdict === "참고용") continue;
    total++;
    if (verdict === "부적합") {
      bad++;
      const proc = spec.group === "si_al_fe" ? "탈검" : spec.recommend;
      if (proc && byProcess[proc] !== undefined) byProcess[proc]++;
    }
  }
  return { total, bad, byProcess };
}

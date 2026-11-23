// 입찰 단가(원/L) → 원/kg → 오르카 납품가 계산과, 납품처 ↔ 입찰 참가 회사 이름 연결
export const L_PER_KG = 0.92;           // 원/L ÷ 0.92 = 원/kg
export const DEFAULT_FREIGHT = 40;      // 제주 운송비(원/kg)

export const CUSTOMERS = [
  { key: "애경", match: ["애경"] },
  { key: "대경", match: ["대경", "이맥"] },
];

export function kgPrice(priceL?: number | null) {
  return priceL ? priceL / L_PER_KG : null;
}
export function supplyPrice(priceL?: number | null, freight?: number | null) {
  const kg = kgPrice(priceL);
  return kg == null ? null : kg - (freight ?? DEFAULT_FREIGHT);
}
export function customerOf(company: string): string | null {
  for (const c of CUSTOMERS) if (c.match.some((m) => (company || "").includes(m))) return c.key;
  return null;
}
export const ym = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export function addMonths(ymStr: string, n: number) {
  const [y, m] = ymStr.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return ym(d);
}
export const won = (v: number | null | undefined, digits = 1) =>
  v == null ? "-" : v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const BID_STATUS = ["낙찰", "부분낙찰", "예정가격초과", "실격", "미참가", "유찰", "기타"];

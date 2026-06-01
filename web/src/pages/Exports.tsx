import TradeModule from "./TradeModule";

export default function Exports() {
  return (
    <TradeModule config={{
      kind: "export",
      title: "원료 수출현황",
      subtitle: "바이어·선박일정·계약서·선적서류·가격을 관리합니다",
      endpoint: "/trade/exports",
      entityType: "export",
      partnerKey: "buyer",
      partnerLabel: "바이어(수입자)",
    }} />
  );
}

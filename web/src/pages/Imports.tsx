import TradeModule from "./TradeModule";

export default function Imports() {
  return (
    <TradeModule config={{
      kind: "import",
      title: "원료 수입현황",
      subtitle: "LC개설·선박일정·계약서·선적서류·가격을 관리합니다",
      endpoint: "/trade/imports",
      entityType: "import",
      partnerKey: "supplier",
      partnerLabel: "공급사(수출자)",
      statusOptions: [
        { v: "contracted", l: "계약" }, { v: "shipped", l: "선적" }, { v: "arrived", l: "도착" },
        { v: "customs", l: "통관" }, { v: "melt_in", l: "멜팅입고" }, { v: "melt_out", l: "멜팅출고" },
        { v: "stored", l: "입고" }, { v: "released", l: "출고" }, { v: "delivered", l: "납품완료" },
      ],
    }} />
  );
}

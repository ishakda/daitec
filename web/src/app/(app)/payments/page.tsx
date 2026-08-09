"use client";
import { useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { useApi } from "@/lib/client";
import { Card, Badge, Select, EmptyState, TableSkeleton } from "@/components/ui";
import { DataTable, Pagination, Column } from "@/components/DataTable";

type Row = {
  id: string; number: string; direction: string; partner_type: string; amount: string;
  payment_date: string; reference: string | null; status: string; method: string;
  customer_name: string | null; supplier_name: string | null; created_by_name: string | null;
};

export default function PaymentsPage() {
  const { t, formatMoney, formatDate } = useI18n();
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState("");
  const query = new URLSearchParams({ page: String(page), limit: "25" });
  if (direction) query.set("direction", direction);
  const { data, isLoading } = useApi<{ data: Row[]; total: number; limit: number }>(`/payments?${query}`);

  const columns: Column<Row>[] = [
    { key: "number", header: t("common.number"), render: (r) => (
      <div><p className="num font-medium">{r.number}</p><p className="text-xs text-ink-3">{r.method}</p></div>
    )},
    { key: "payment_date", header: t("common.date"), render: (r) => formatDate(r.payment_date) },
    { key: "partner", header: t("payments.partner"), render: (r) => r.customer_name ?? r.supplier_name ?? "—" },
    { key: "direction", header: t("payments.direction"), render: (r) => (
      <Badge tone={r.direction === "in" ? "ok" : "warn"}>{t(`payments.${r.direction}`)}</Badge>
    )},
    { key: "amount", header: t("common.amount"), align: "end", render: (r) => (
      <span className={`num font-medium ${r.direction === "in" ? "text-ok" : "text-danger"}`}>
        {r.direction === "in" ? "+" : "−"}{formatMoney(r.amount)}
      </span>
    )},
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-lg font-semibold">{t("payments.title")}</h1>
      <Card pad={false}>
        <div className="border-b border-line p-3">
          <Select value={direction} onChange={(e) => { setDirection(e.target.value); setPage(1); }} className="max-w-[190px]">
            <option value="">{t("common.all")}</option>
            <option value="in">{t("payments.in")}</option>
            <option value="out">{t("payments.out")}</option>
          </Select>
        </div>
        {isLoading && !data ? <TableSkeleton /> :
          !data?.data.length ? <EmptyState title={t("payments.empty")} /> : (
            <>
              <DataTable columns={columns} rows={data.data} />
              <Pagination page={page} setPage={setPage} total={data.total} limit={data.limit} />
            </>
          )}
      </Card>
    </div>
  );
}

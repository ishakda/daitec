"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useI18n } from "@/components/I18nProvider";
import { useApi, useMe } from "@/lib/client";
import { Button, Card, Badge, Select, EmptyState, TableSkeleton, paymentTone } from "@/components/ui";
import { DataTable, Pagination, Column } from "@/components/DataTable";

type SaleRow = {
  id: string; number: string; sale_type: string; sale_date: string; due_date: string | null;
  payment_status: string; total: string; paid_amount: string; gross_profit?: string;
  customer_name: string | null; created_by_name: string | null;
};
type ListResp = { data: SaleRow[]; page: number; limit: number; total: number };

export default function SalesPage() {
  const { t, formatMoney, formatDate } = useI18n();
  const router = useRouter();
  const { can } = useMe();
  const [page, setPage] = useState(1);
  const [type, setType] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");

  const query = new URLSearchParams({ page: String(page), limit: "25" });
  if (type) query.set("type", type);
  if (paymentStatus) query.set("paymentStatus", paymentStatus);
  const { data, isLoading } = useApi<ListResp>(`/sales?${query}`);

  const typeLabel: Record<string, string> = {
    invoice: t("sales.invoice"), pos: t("sales.ticket"),
    proforma: t("sales.proforma"), return: t("sales.return"),
  };

  const columns: Column<SaleRow>[] = [
    { key: "number", header: t("common.number"), render: (r) => (
      <div>
        <p className="num font-medium">{r.number}</p>
        <p className="text-xs text-ink-3">{typeLabel[r.sale_type]}</p>
      </div>
    )},
    { key: "sale_date", header: t("common.date"), render: (r) => (
      <div>
        <p>{formatDate(r.sale_date)}</p>
        {r.due_date && <p className="text-xs text-ink-3">{t("common.dueDate")}: {formatDate(r.due_date)}</p>}
      </div>
    )},
    { key: "customer_name", header: t("sales.customer"), render: (r) => r.customer_name ?? t("sales.walkIn") },
    { key: "payment_status", header: t("sales.paymentStatus"), render: (r) => (
      <Badge tone={paymentTone(r.payment_status)}>{t(`sales.${r.payment_status}`)}</Badge>
    )},
    { key: "total", header: t("common.total"), align: "end", render: (r) => (
      <div>
        <p className="num font-medium">{formatMoney(r.total)}</p>
        {Number(r.paid_amount) > 0 && Number(r.paid_amount) < Number(r.total) && (
          <p className="num text-xs text-ink-3">{t("common.paid")}: {formatMoney(r.paid_amount)}</p>
        )}
      </div>
    )},
    ...(can("sales.view_profit") ? [{
      key: "gross_profit", header: t("common.profit"), align: "end" as const,
      render: (r: SaleRow) => r.gross_profit != null
        ? <span className={`num text-[13px] ${Number(r.gross_profit) >= 0 ? "text-ok" : "text-danger"}`}>{formatMoney(r.gross_profit)}</span>
        : "—",
    }] : []),
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{t("sales.title")}</h1>
        <div className="flex gap-2">
          <Link href="/pos"><Button variant="secondary"><ShoppingCart size={15} /> {t("nav.pos")}</Button></Link>
          {can("sales.create") && (
            <Link href="/sales/new"><Button><Plus size={15} /> {t("sales.newSale")}</Button></Link>
          )}
        </div>
      </div>
      <Card pad={false}>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="max-w-[170px]">
            <option value="">{t("common.all")}</option>
            <option value="invoice">{t("sales.invoice")}</option>
            <option value="pos">{t("sales.ticket")}</option>
            <option value="return">{t("sales.return")}</option>
            <option value="proforma">{t("sales.proforma")}</option>
          </Select>
          <Select value={paymentStatus} onChange={(e) => { setPaymentStatus(e.target.value); setPage(1); }} className="max-w-[170px]">
            <option value="">{t("common.all")} — {t("sales.paymentStatus")}</option>
            <option value="unpaid">{t("sales.unpaid")}</option>
            <option value="partial">{t("sales.partial")}</option>
            <option value="paid">{t("sales.paid")}</option>
          </Select>
        </div>
        {isLoading && !data ? <TableSkeleton /> :
          !data?.data.length ? (
            <EmptyState title={t("sales.empty")} hint={t("sales.emptyHint")} />
          ) : (
            <>
              <DataTable columns={columns} rows={data.data} onRowClick={(r) => router.push(`/sales/${r.id}`)} />
              <Pagination page={page} setPage={setPage} total={data.total} limit={data.limit} />
            </>
          )}
      </Card>
    </div>
  );
}

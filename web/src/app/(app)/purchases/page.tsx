"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useApi, useMe } from "@/lib/client";
import { Button, Card, Badge, Select, EmptyState, TableSkeleton, paymentTone } from "@/components/ui";
import { DataTable, Pagination, Column } from "@/components/DataTable";

type PoRow = { id: string; number: string; status: string; order_date: string; expected_date: string | null; total: string; supplier_name: string; item_count: number };
type SiRow = { id: string; number: string; supplier_ref: string | null; invoice_date: string; due_date: string | null; total: string; paid_amount: string; payment_status: string; supplier_name: string };

const statusTone: Record<string, "ok" | "warn" | "danger" | "info" | "neutral"> = {
  pending: "warn", confirmed: "info", partially_received: "warn", received: "ok", cancelled: "neutral", draft: "neutral",
};

function PurchasesInner() {
  const { t, formatMoney, formatDate } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useMe();
  const [tab, setTab] = useState<"orders" | "invoices">(params.get("tab") === "invoices" ? "invoices" : "orders");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");

  const poQuery = new URLSearchParams({ page: String(page), limit: "25" });
  if (status) poQuery.set("status", status);
  const { data: orders, isLoading: poLoading } = useApi<{ data: PoRow[]; total: number; limit: number }>(
    tab === "orders" ? `/purchases/orders?${poQuery}` : null);
  const { data: invoices, isLoading: siLoading } = useApi<{ data: SiRow[] }>(
    tab === "invoices" ? `/purchases/invoices?page=${page}&limit=25` : null);

  const poCols: Column<PoRow>[] = [
    { key: "number", header: t("common.number"), render: (r) => (
      <div><p className="num font-medium">{r.number}</p>
        <p className="text-xs text-ink-3">{r.item_count} {t("common.items")}</p></div>
    )},
    { key: "supplier_name", header: t("purchases.supplier") },
    { key: "order_date", header: t("purchases.orderDate"), render: (r) => formatDate(r.order_date) },
    { key: "status", header: t("common.status"), render: (r) => (
      <Badge tone={statusTone[r.status] ?? "neutral"}>{t(`purchases.${
        r.status === "partially_received" ? "partiallyReceived" : r.status}`)}</Badge>
    )},
    { key: "total", header: t("common.total"), align: "end", render: (r) => <span className="num font-medium">{formatMoney(r.total)}</span> },
  ];

  const siCols: Column<SiRow>[] = [
    { key: "number", header: t("common.number"), render: (r) => (
      <div><p className="num font-medium">{r.number}</p>
        {r.supplier_ref && <p className="text-xs text-ink-3">{t("purchases.supplierRef")}: {r.supplier_ref}</p>}</div>
    )},
    { key: "supplier_name", header: t("purchases.supplier") },
    { key: "invoice_date", header: t("common.date"), render: (r) => (
      <div><p>{formatDate(r.invoice_date)}</p>
        {r.due_date && <p className="text-xs text-ink-3">{t("common.dueDate")}: {formatDate(r.due_date)}</p>}</div>
    )},
    { key: "payment_status", header: t("sales.paymentStatus"), render: (r) => (
      <Badge tone={paymentTone(r.payment_status)}>{t(`sales.${r.payment_status}`)}</Badge>
    )},
    { key: "total", header: t("common.total"), align: "end", render: (r) => (
      <div><p className="num font-medium">{formatMoney(r.total)}</p>
        {Number(r.paid_amount) > 0 && <p className="num text-xs text-ink-3">{t("common.paid")}: {formatMoney(r.paid_amount)}</p>}</div>
    )},
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{t("purchases.title")}</h1>
        {can("purchases.create") && (
          <Link href="/purchases/new"><Button><Plus size={15} /> {t("purchases.newOrder")}</Button></Link>
        )}
      </div>
      <div className="flex gap-1 rounded-lg border border-line bg-surface p-1 w-fit">
        {(["orders", "invoices"] as const).map((tb) => (
          <button key={tb} onClick={() => { setTab(tb); setPage(1); }}
            className={`rounded-md px-3.5 py-1.5 text-[13px] font-medium ${tab === tb ? "bg-navy text-white" : "text-ink-2 hover:bg-canvas"}`}>
            {t(`purchases.${tb}`)}
          </button>
        ))}
      </div>
      <Card pad={false}>
        {tab === "orders" && (
          <div className="border-b border-line p-3">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="max-w-[200px]">
              <option value="">{t("common.all")}</option>
              <option value="pending">{t("purchases.pending")}</option>
              <option value="partially_received">{t("purchases.partiallyReceived")}</option>
              <option value="received">{t("purchases.received")}</option>
            </Select>
          </div>
        )}
        {tab === "orders" ? (
          poLoading && !orders ? <TableSkeleton /> :
          !orders?.data.length ? <EmptyState title={t("purchases.empty")} /> : (
            <>
              <DataTable columns={poCols} rows={orders.data} onRowClick={(r) => router.push(`/purchases/${r.id}`)} />
              <Pagination page={page} setPage={setPage} total={orders.total} limit={orders.limit} />
            </>
          )
        ) : (
          siLoading && !invoices ? <TableSkeleton /> :
          !invoices?.data.length ? <EmptyState title={t("purchases.empty")} /> : (
            <DataTable columns={siCols} rows={invoices.data} />
          )
        )}
      </Card>
    </div>
  );
}

export default function PurchasesPage() {
  return <Suspense><PurchasesInner /></Suspense>;
}

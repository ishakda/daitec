"use client";
import { useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { useApi } from "@/lib/client";
import { Card, Badge, Select, EmptyState, TableSkeleton } from "@/components/ui";
import { DataTable, Pagination, Column } from "@/components/DataTable";

type Row = {
  id: string; action: string; entity_type: string; entity_label: string | null;
  old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null;
  created_at: string; user_name: string | null; user_email: string | null;
};

const actionTone: Record<string, "ok" | "warn" | "danger" | "info" | "neutral"> = {
  create: "ok", update: "info", delete: "danger", refund: "warn",
  adjust_stock: "warn", open_register: "info", close_register: "info",
};

export default function AuditPage() {
  const { t, formatDateTime } = useI18n();
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState("");
  const query = new URLSearchParams({ page: String(page), limit: "50" });
  if (entityType) query.set("entityType", entityType);
  const { data, isLoading } = useApi<{ data: Row[] }>(`/audit?${query}`);

  const columns: Column<Row>[] = [
    { key: "created_at", header: t("audit.when"), render: (r) => <span className="text-[13px]">{formatDateTime(r.created_at)}</span> },
    { key: "user_name", header: t("audit.user"), render: (r) => (
      <div><p className="font-medium">{r.user_name ?? "—"}</p><p className="text-xs text-ink-3">{r.user_email}</p></div>
    )},
    { key: "action", header: t("audit.action"), render: (r) => (
      <Badge tone={actionTone[r.action] ?? "neutral"}>{r.action}</Badge>
    )},
    { key: "entity", header: t("audit.entity"), render: (r) => (
      <div><p className="font-medium">{r.entity_label ?? "—"}</p><p className="text-xs text-ink-3">{r.entity_type}</p></div>
    )},
    { key: "details", header: t("audit.details"), render: (r) => (
      <details className="text-xs text-ink-3">
        <summary className="cursor-pointer">…</summary>
        <pre className="mt-1 max-w-sm overflow-x-auto whitespace-pre-wrap rounded bg-canvas p-2 text-[11px]" dir="ltr">
          {JSON.stringify({ old: r.old_values, new: r.new_values }, null, 1)}
        </pre>
      </details>
    )},
  ];

  const entityTypes = ["product", "sale", "payment", "customer", "supplier", "purchase_order", "goods_receipt", "expense", "member", "role", "register_session", "stock_transfer"];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-lg font-semibold">{t("audit.title")}</h1>
      <Card pad={false}>
        <div className="border-b border-line p-3">
          <Select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }} className="max-w-[220px]">
            <option value="">{t("common.all")}</option>
            {entityTypes.map((e) => <option key={e} value={e}>{e}</option>)}
          </Select>
        </div>
        {isLoading && !data ? <TableSkeleton /> :
          !data?.data.length ? <EmptyState title={t("audit.empty")} /> : (
            <>
              <DataTable columns={columns} rows={data.data} />
              <Pagination page={page} setPage={setPage} hasMore={(data?.data.length ?? 0) >= 50} />
            </>
          )}
      </Card>
    </div>
  );
}

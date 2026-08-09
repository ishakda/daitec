"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/I18nProvider";
import { useApi, apiFetch, useMe, ClientApiError } from "@/lib/client";
import { Button, Card, Badge, Modal, Field, Select, EmptyState, TableSkeleton } from "@/components/ui";
import { DataTable, Pagination, Column } from "@/components/DataTable";

type Row = { id: string; number: string; status: string; valid_until: string | null; total: string; created_at: string; customer_name: string | null };

const tone: Record<string, "ok" | "warn" | "danger" | "info" | "neutral"> = {
  draft: "neutral", sent: "info", accepted: "ok", rejected: "danger", expired: "warn", converted: "ok",
};

export default function QuotationsPage() {
  const { t, formatMoney, formatDate } = useI18n();
  const router = useRouter();
  const { can } = useMe();
  const [page, setPage] = useState(1);
  const [convertId, setConvertId] = useState<string | null>(null);
  const { data, isLoading, mutate } = useApi<{ data: Row[] }>(`/quotations?page=${page}&limit=25`);

  const columns: Column<Row>[] = [
    { key: "number", header: t("common.number"), render: (r) => <span className="num font-medium">{r.number}</span> },
    { key: "customer_name", header: t("sales.customer"), render: (r) => r.customer_name ?? "—" },
    { key: "created_at", header: t("common.date"), render: (r) => formatDate(r.created_at) },
    { key: "valid_until", header: t("quotations.validUntil"), render: (r) => r.valid_until ? formatDate(r.valid_until) : "—" },
    { key: "status", header: t("common.status"), render: (r) => (
      <Badge tone={tone[r.status] ?? "neutral"}>{t(`quotations.${r.status}`)}</Badge>
    )},
    { key: "total", header: t("common.total"), align: "end", render: (r) => <span className="num font-medium">{formatMoney(r.total)}</span> },
    { key: "actions", header: "", align: "end", render: (r) =>
      r.status !== "converted" && can("sales.create") ? (
        <Button variant="secondary" className="h-7 px-2.5 text-xs"
          onClick={(e) => { e.stopPropagation(); setConvertId(r.id); }}>
          {t("quotations.convert")}
        </Button>
      ) : null },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t("quotations.title")}</h1>
        {can("sales.create") && (
          <Button onClick={() => router.push("/sales/new")}>{t("quotations.new")}</Button>
        )}
      </div>
      <Card pad={false}>
        {isLoading && !data ? <TableSkeleton /> :
          !data?.data.length ? <EmptyState title={t("quotations.empty")} /> : (
            <>
              <DataTable columns={columns} rows={data.data} />
              <Pagination page={page} setPage={setPage} hasMore={(data?.data.length ?? 0) >= 25} />
            </>
          )}
      </Card>
      {convertId && (
        <ConvertModal quotationId={convertId} onClose={() => setConvertId(null)}
          onDone={(saleId) => { setConvertId(null); mutate(); router.push(`/sales/${saleId}`); }} />
      )}
    </div>
  );
}

function ConvertModal({ quotationId, onClose, onDone }: {
  quotationId: string; onClose: () => void; onDone: (saleId: string) => void;
}) {
  const { t } = useI18n();
  const { data: warehouses } = useApi<{ data: Array<{ id: string; name: string; is_default: boolean }> }>("/warehouses");
  const [warehouseId, setWarehouseId] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const wh = warehouseId || (warehouses?.data.find((w) => w.is_default) ?? warehouses?.data[0])?.id || "";

  return (
    <Modal open onClose={onClose} title={t("quotations.convert")}>
      <div className="space-y-4">
        <Field label={t("common.warehouse")}>
          <Select value={wh} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses?.data.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
        {err && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={loading} disabled={!wh} onClick={async () => {
            setLoading(true); setErr(null);
            try {
              const r = await apiFetch<{ saleId: string }>(`/quotations/${quotationId}/convert`, {
                method: "POST", json: { warehouseId: wh },
              });
              onDone(r.saleId);
            } catch (e) {
              setErr(e instanceof ClientApiError ? e.message : t("common.errorGeneric"));
              setLoading(false);
            }
          }}>
            {t("common.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

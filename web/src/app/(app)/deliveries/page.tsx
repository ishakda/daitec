"use client";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Plus, MapPin, Camera } from "lucide-react";
import Link from "next/link";
import { useI18n } from "@/components/I18nProvider";
import { useApi, apiFetch, useMe, ClientApiError } from "@/lib/client";
import { Button, Card, Badge, Select, Input, Field, Modal, EmptyState, TableSkeleton } from "@/components/ui";
import { DataTable, Pagination, Column } from "@/components/DataTable";
import { ProofViewer } from "@/components/ProofOfDelivery";

const LocationPicker = dynamic(
  () => import("@/components/MapKit").then((m) => m.LocationPicker),
  { ssr: false }
);

type Row = {
  id: string; number: string; status: string; address: string | null; city: string | null;
  cod_amount: string; created_at: string; customer_name: string | null;
  courier_name: string | null; courier_id: string | null; sale_number: string | null; sale_id: string | null;
  failure_reason: string | null; proof_count: number; qr_verified_at: string | null;
};
type Courier = { id: string; name: string };

const tone: Record<string, "ok" | "warn" | "danger" | "info" | "neutral"> = {
  pending: "neutral", assigned: "info", picked_up: "warn",
  out_for_delivery: "info", delivered: "ok", failed: "danger", cancelled: "neutral",
};

function DeliveriesInner() {
  const { t, formatMoney, formatDate } = useI18n();
  const params = useSearchParams();
  const { can } = useMe();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [showNew, setShowNew] = useState(params.get("new") === "1");
  const [proofFor, setProofFor] = useState<Row | null>(null);

  const query = new URLSearchParams({ page: String(page), limit: "25" });
  if (status) query.set("status", status);
  if (activeOnly && !status) query.set("active", "true");
  const { data, isLoading, mutate } = useApi<{ data: Row[]; total: number; limit: number }>(`/deliveries?${query}`);
  const { data: mapData } = useApi<{ couriers: Courier[] }>(can("deliveries.assign") ? "/map" : null);
  const couriers = mapData?.couriers ?? [];

  const columns: Column<Row>[] = [
    { key: "number", header: t("common.number"), render: (r) => (
      <div>
        <p className="num font-medium">{r.number}</p>
        <p className="text-xs text-ink-3">{formatDate(r.created_at)}{r.sale_number ? ` · ${r.sale_number}` : ""}</p>
      </div>
    )},
    { key: "customer_name", header: t("sales.customer"), render: (r) => (
      <div>
        <p className="font-medium">{r.customer_name ?? "—"}</p>
        <p className="text-xs text-ink-3">{[r.address, r.city].filter(Boolean).join(", ") || "—"}</p>
      </div>
    )},
    { key: "status", header: t("common.status"), render: (r) => (
      <div>
        <Badge tone={tone[r.status] ?? "neutral"}>{t(`delivery.status.${r.status}`)}</Badge>
        {r.qr_verified_at && <Badge tone="ok"><span className="text-[10.5px]">✓ {t("qr.verifiedBadge")}</span></Badge>}
        {r.failure_reason && <p className="mt-0.5 text-xs text-danger">{r.failure_reason}</p>}
      </div>
    )},
    { key: "courier", header: t("delivery.courier"), render: (r) =>
      can("deliveries.assign") && !["delivered", "cancelled"].includes(r.status) ? (
        <Select
          value={r.courier_id ?? ""}
          className="!h-8 max-w-[170px]"
          onChange={async (e) => {
            await apiFetch(`/deliveries/${r.id}/assign`, {
              method: "POST", json: { courierId: e.target.value || null },
            }).catch(() => {});
            mutate();
          }}
        >
          <option value="">{t("delivery.noCourier")}</option>
          {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      ) : (r.courier_name ?? "—") },
    { key: "cod_amount", header: t("delivery.codShort"), align: "end", render: (r) =>
      Number(r.cod_amount) > 0 ? <span className="num font-medium">{formatMoney(r.cod_amount)}</span> : "—" },
    { key: "proofs", header: "", align: "end", render: (r) =>
      r.proof_count > 0 ? (
        <button title={t("delivery.pod_view")}
          onClick={(e) => { e.stopPropagation(); setProofFor(r); }}
          className="rounded-lg p-1.5 text-accent hover:bg-accent-soft">
          <Camera size={16} />
        </button>
      ) : null },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{t("delivery.title")}</h1>
        <div className="flex gap-2">
          <Link href="/map"><Button variant="secondary"><MapPin size={15} /> {t("map.title")}</Button></Link>
          {can("deliveries.create") && (
            <Button onClick={() => setShowNew(true)}><Plus size={15} /> {t("delivery.new")}</Button>
          )}
        </div>
      </div>
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="max-w-[200px]">
            <option value="">{t("common.all")}</option>
            {Object.keys(tone).map((s) => <option key={s} value={s}>{t(`delivery.status.${s}`)}</option>)}
          </Select>
          {!status && (
            <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
              <input type="checkbox" checked={activeOnly} onChange={(e) => { setActiveOnly(e.target.checked); setPage(1); }} />
              {t("delivery.activeOnly")}
            </label>
          )}
        </div>
        {isLoading && !data ? <TableSkeleton /> :
          !data?.data.length ? <EmptyState title={t("delivery.empty")} /> : (
            <>
              <DataTable columns={columns} rows={data.data} />
              <Pagination page={page} setPage={setPage} total={data.total} limit={data.limit} />
            </>
          )}
      </Card>
      {showNew && (
        <NewDeliveryModal couriers={couriers} onClose={() => setShowNew(false)}
          onDone={() => { setShowNew(false); mutate(); }} />
      )}
      {proofFor && (
        <ProofViewer deliveryId={proofFor.id} number={proofFor.number} onClose={() => setProofFor(null)} />
      )}
    </div>
  );
}

export function NewDeliveryModal({ couriers, saleId, onClose, onDone }: {
  couriers: Courier[]; saleId?: string; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [customerQ, setCustomerQ] = useState("");
  const [customerId, setCustomerId] = useState("");
  const { data: customers } = useApi<{ data: Array<{ id: string; name: string }> }>(
    saleId ? null : `/customers?q=${encodeURIComponent(customerQ)}&limit=10`);
  const [courierId, setCourierId] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [cod, setCod] = useState("");
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true); setErr(null);
    try {
      await apiFetch("/deliveries", {
        method: "POST",
        json: {
          saleId: saleId ?? null,
          customerId: customerId || null,
          courierId: courierId || null,
          address: address || null,
          phone: phone || null,
          codAmount: cod !== "" ? Number(cod) : 0,
          latitude: pos?.lat ?? null,
          longitude: pos?.lng ?? null,
          notes: notes || null,
        },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof ClientApiError ? e.message : t("common.errorGeneric"));
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("delivery.new")} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {!saleId && (
            <Field label={t("sales.customer")}>
              <Input list="delivery-customers" value={customerQ}
                onChange={(e) => {
                  setCustomerQ(e.target.value);
                  const m = customers?.data.find((c) => c.name === e.target.value);
                  setCustomerId(m?.id ?? "");
                }} />
              <datalist id="delivery-customers">
                {customers?.data.map((c) => <option key={c.id} value={c.name} />)}
              </datalist>
            </Field>
          )}
          <Field label={t("delivery.courier")}>
            <Select value={courierId} onChange={(e) => setCourierId(e.target.value)}>
              <option value="">{t("delivery.noCourier")}</option>
              {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label={t("common.address")}>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label={t("common.phone")}>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label={t("delivery.cod")}>
            <Input type="number" min="0" step="0.01" value={cod} onChange={(e) => setCod(e.target.value)} />
          </Field>
          <Field label={t("common.notes")}>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <Field label={t("map.setPosition")}>
          <LocationPicker value={pos} onChange={setPos} searchPlaceholder={t("map.searchAddress")} />
        </Field>
        {err && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={loading} onClick={submit}>{t("common.create")}</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function DeliveriesPage() {
  return <Suspense><DeliveriesInner /></Suspense>;
}

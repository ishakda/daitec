"use client";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { useI18n } from "./I18nProvider";
import { useApi, apiFetch, useMe, ClientApiError } from "@/lib/client";
import { Button, Input, Field, Card, Badge, Modal, EmptyState, TableSkeleton } from "./ui";
import { DataTable, Pagination, Column } from "./DataTable";

const LocationPicker = dynamic(() => import("./MapKit").then((m) => m.LocationPicker), { ssr: false });

type PartnerRow = {
  id: string; name: string; company_name: string | null; phone: string | null;
  city: string | null; balance?: string; credit_limit?: string | null; is_active: boolean;
};
type ListResp = { data: PartnerRow[]; page: number; limit: number; total: number };

export function PartnerListPage({ kind }: { kind: "customers" | "suppliers" }) {
  const { t, formatMoney } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useMe();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [withDebt, setWithDebt] = useState(false);
  const [showNew, setShowNew] = useState(params.get("new") === "1");

  useEffect(() => {
    const id = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 250);
    return () => clearTimeout(id);
  }, [q]);

  const query = new URLSearchParams({ page: String(page), limit: "25" });
  if (debouncedQ) query.set("q", debouncedQ);
  if (withDebt) query.set("withDebt", "true");
  const { data, isLoading, mutate } = useApi<ListResp>(`/${kind}?${query}`);

  const columns: Column<PartnerRow>[] = [
    { key: "name", header: t("common.name"), render: (r) => (
      <div>
        <p className="font-medium">{r.name}</p>
        {r.company_name && <p className="text-xs text-ink-3">{r.company_name}</p>}
      </div>
    )},
    { key: "phone", header: t("common.phone"), render: (r) => <span className="num">{r.phone ?? "—"}</span> },
    { key: "city", header: t("common.city"), render: (r) => r.city ?? "—" },
    { key: "balance", header: t(`${kind}.debt`), align: "end", render: (r) =>
      r.balance != null ? (
        <span className={`num font-medium ${Number(r.balance) > 0 ? "text-warn" : "text-ink-2"}`}>
          {formatMoney(r.balance)}
        </span>
      ) : "—" },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{t(`${kind}.title`)}</h1>
        {can(`${kind}.create`) && (
          <Button onClick={() => setShowNew(true)}><Plus size={15} /> {t(`${kind}.add`)}</Button>
        )}
      </div>
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Input placeholder={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
            <input type="checkbox" checked={withDebt} onChange={(e) => { setWithDebt(e.target.checked); setPage(1); }} />
            {t(`${kind}.withDebt`)}
          </label>
        </div>
        {isLoading && !data ? <TableSkeleton /> :
          !data?.data.length ? (
            <EmptyState title={t(`${kind}.empty`)} hint={kind === "customers" ? t("customers.emptyHint") : undefined}
              action={can(`${kind}.create`) && <Button onClick={() => setShowNew(true)}><Plus size={15} /> {t(`${kind}.add`)}</Button>} />
          ) : (
            <>
              <DataTable columns={columns} rows={data.data} onRowClick={(r) => router.push(`/${kind}/${r.id}`)} />
              <Pagination page={page} setPage={setPage} total={data.total} limit={data.limit} />
            </>
          )}
      </Card>
      <PartnerModal kind={kind} open={showNew} onClose={() => setShowNew(false)}
        onDone={() => { setShowNew(false); mutate(); }} />
    </div>
  );
}

export function PartnerModal({ kind, open, onClose, onDone, initial, partnerId }: {
  kind: "customers" | "suppliers"; open: boolean; onClose: () => void; onDone: () => void;
  initial?: Record<string, string | null>; partnerId?: string;
}) {
  const { t } = useI18n();
  const empty = { name: "", companyName: "", phone: "", email: "", address: "", city: "", wilaya: "", nif: "", nis: "", rc: "", ai: "", creditLimit: "", paymentTermsDays: "" };
  const [form, setForm] = useState<Record<string, string>>(empty);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [posOpen, setPosOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (open) {
      setForm(initial
        ? {
            name: initial.name ?? "", companyName: initial.company_name ?? "", phone: initial.phone ?? "",
            email: initial.email ?? "", address: initial.address ?? "", city: initial.city ?? "",
            wilaya: initial.wilaya ?? "", nif: initial.nif ?? "", nis: initial.nis ?? "",
            rc: initial.rc ?? "", ai: initial.ai ?? "",
            creditLimit: initial.credit_limit != null ? String(initial.credit_limit) : "",
            paymentTermsDays: initial.payment_terms_days != null ? String(initial.payment_terms_days) : "",
          }
        : empty);
      const hasPos = !!(initial && initial.latitude != null && initial.longitude != null);
      setPos(hasPos ? { lat: Number(initial!.latitude), lng: Number(initial!.longitude) } : null);
      setPosOpen(hasPos);
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr(null);
    try {
      const json = {
        name: form.name,
        companyName: form.companyName || null, phone: form.phone || null,
        email: form.email || null, address: form.address || null, city: form.city || null,
        wilaya: form.wilaya || null, nif: form.nif || null, nis: form.nis || null,
        rc: form.rc || null, ai: form.ai || null,
        creditLimit: form.creditLimit !== "" ? Number(form.creditLimit) : null,
        paymentTermsDays: form.paymentTermsDays !== "" ? Number(form.paymentTermsDays) : null,
        ...(kind === "customers" ? { latitude: pos?.lat ?? null, longitude: pos?.lng ?? null } : {}),
      };
      if (partnerId) await apiFetch(`/${kind}/${partnerId}`, { method: "PATCH", json });
      else await apiFetch(`/${kind}`, { method: "POST", json });
      onDone();
    } catch (e2) {
      setErr(e2 instanceof ClientApiError ? e2.message : t("common.errorGeneric"));
    } finally { setLoading(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={partnerId ? t("common.edit") : t(`${kind}.add`)} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("common.name")} required>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus required />
          </Field>
          <Field label={t(`${kind === "customers" ? "customers" : "customers"}.companyName`)}>
            <Input value={form.companyName} onChange={(e) => set("companyName", e.target.value)} />
          </Field>
          <Field label={t("common.phone")}>
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label={t("common.email")}>
            <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label={t("common.address")}>
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label={t("common.city")}>
            <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label={t("customers.creditLimit")}>
            <Input type="number" min="0" step="0.01" value={form.creditLimit} onChange={(e) => set("creditLimit", e.target.value)} />
          </Field>
          <Field label={`${t("common.dueDate")} (jours)`}>
            <Input type="number" min="0" max="365" value={form.paymentTermsDays} onChange={(e) => set("paymentTermsDays", e.target.value)} />
          </Field>
        </div>
        {kind === "customers" && (
          <details className="rounded-lg border border-line p-3" open={posOpen}
            onToggle={(e) => setPosOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer text-[13px] font-medium text-ink-2">{t("map.position")}</summary>
            {/* Mount the map only while expanded so Leaflet never initialises
                inside a hidden 0×0 container (source of _leaflet_pos crashes). */}
            {posOpen && (
              <div className="mt-3">
                <LocationPicker value={pos} onChange={setPos} searchPlaceholder={t("map.searchAddress")} />
              </div>
            )}
          </details>
        )}
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-[13px] font-medium text-ink-2">{t("customers.identifiers")}</summary>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="NIF"><Input value={form.nif} onChange={(e) => set("nif", e.target.value)} /></Field>
            <Field label="NIS"><Input value={form.nis} onChange={(e) => set("nis", e.target.value)} /></Field>
            <Field label="RC"><Input value={form.rc} onChange={(e) => set("rc", e.target.value)} /></Field>
            <Field label="AI"><Input value={form.ai} onChange={(e) => set("ai", e.target.value)} /></Field>
          </div>
        </details>
        {err && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" loading={loading}>{t("common.save")}</Button>
        </div>
      </form>
    </Modal>
  );
}

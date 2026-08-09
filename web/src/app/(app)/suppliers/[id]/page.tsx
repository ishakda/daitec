"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Wallet } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useApi, apiFetch, useMe, ClientApiError } from "@/lib/client";
import { Button, Card, Badge, Spinner, ErrorState, Modal, Field, Input, Select, Stat, paymentTone } from "@/components/ui";
import { PartnerModal } from "@/components/PartnerPages";

type Detail = {
  id: string; name: string; company_name: string | null; contact_name: string | null;
  phone: string | null; email: string | null; city: string | null;
  balance?: string; credit_limit?: string | null;
  stats: { orders: number; total_purchases: string };
  recentOrders: Array<{ id: string; number: string; status: string; order_date: string; total: string }>;
  recentInvoices: Array<{ id: string; number: string; supplier_ref: string | null; invoice_date: string; due_date: string | null; total: string; paid_amount: string; payment_status: string }>;
  recentPayments: Array<{ id: string; number: string; direction: string; amount: string; payment_date: string; method: string }>;
};
type Method = { id: string; name: string };

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, formatMoney, formatDate } = useI18n();
  const router = useRouter();
  const { can } = useMe();
  const { data: s, error, isLoading, mutate } = useApi<Detail>(`/suppliers/${id}`);
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  if (isLoading) return <Spinner label={t("common.loading")} />;
  if (error || !s) return <ErrorState message={t("common.errorGeneric")} />;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => router.push("/suppliers")} className="rounded-lg p-2 text-ink-3 hover:bg-surface hover:text-ink">
          <ArrowLeft size={17} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{s.name}</h1>
          <p className="text-xs text-ink-3">{[s.company_name, s.contact_name, s.phone].filter(Boolean).join(" · ")}</p>
        </div>
        {can("payments.create") && Number(s.balance ?? 0) > 0 && (
          <Button onClick={() => setPayOpen(true)}><Wallet size={15} /> {t("payments.supplierPayment")}</Button>
        )}
        {can("suppliers.edit") && <Button variant="secondary" onClick={() => setEditOpen(true)}>{t("common.edit")}</Button>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {s.balance != null && (
          <Stat label={t("suppliers.debt")} value={formatMoney(s.balance)}
            tone={Number(s.balance) > 0 ? "warn" : "ok"} />
        )}
        <Stat label={t("customers.totalPurchases")} value={formatMoney(s.stats.total_purchases)} />
        <Stat label={t("purchases.orders")} value={<span className="num">{s.stats.orders}</span>} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("purchases.invoices")} pad={false}>
          <table className="w-full text-sm">
            <tbody>
              {s.recentInvoices.map((si) => (
                <tr key={si.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2"><span className="num font-medium">{si.number}</span>
                    <br /><span className="text-xs text-ink-3">{formatDate(si.invoice_date)}</span></td>
                  <td className="px-4 py-2"><Badge tone={paymentTone(si.payment_status)}>{t(`sales.${si.payment_status}`)}</Badge></td>
                  <td className="num px-4 py-2 text-end">
                    <span className="font-medium">{formatMoney(si.total)}</span>
                    {Number(si.paid_amount) > 0 && Number(si.paid_amount) < Number(si.total) && (
                      <><br /><span className="text-xs text-ink-3">{t("common.paid")}: {formatMoney(si.paid_amount)}</span></>
                    )}
                  </td>
                </tr>
              ))}
              {!s.recentInvoices.length && <tr><td className="px-4 py-6 text-center text-ink-3">{t("common.none")}</td></tr>}
            </tbody>
          </table>
        </Card>
        <div className="space-y-4">
          <Card title={t("suppliers.recentOrders")} pad={false}>
            <table className="w-full text-sm">
              <tbody>
                {s.recentOrders.map((o) => (
                  <tr key={o.id} onClick={() => router.push(`/purchases/${o.id}`)}
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-canvas">
                    <td className="px-4 py-2"><span className="num font-medium">{o.number}</span>
                      <br /><span className="text-xs text-ink-3">{formatDate(o.order_date)}</span></td>
                    <td className="px-4 py-2"><Badge tone="neutral">{o.status}</Badge></td>
                    <td className="num px-4 py-2 text-end font-medium">{formatMoney(o.total)}</td>
                  </tr>
                ))}
                {!s.recentOrders.length && <tr><td className="px-4 py-6 text-center text-ink-3">{t("common.none")}</td></tr>}
              </tbody>
            </table>
          </Card>
          <Card title={t("customers.recentPayments")} pad={false}>
            <table className="w-full text-sm">
              <tbody>
                {s.recentPayments.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2"><span className="num text-xs text-ink-3">{p.number}</span><br />{p.method}</td>
                    <td className="px-4 py-2 text-xs text-ink-3">{formatDate(p.payment_date)}</td>
                    <td className="num px-4 py-2 text-end font-medium text-danger">−{formatMoney(p.amount)}</td>
                  </tr>
                ))}
                {!s.recentPayments.length && <tr><td className="px-4 py-6 text-center text-ink-3">{t("common.none")}</td></tr>}
              </tbody>
            </table>
          </Card>
        </div>
      </div>

      <PartnerModal kind="suppliers" open={editOpen} onClose={() => setEditOpen(false)}
        onDone={() => { setEditOpen(false); mutate(); }} partnerId={id}
        initial={s as unknown as Record<string, string | null>} />
      {payOpen && s.balance != null && (
        <PaySupplierModal supplierId={id} balance={Number(s.balance)}
          invoices={s.recentInvoices.filter((i) => ["unpaid", "partial"].includes(i.payment_status))}
          onClose={() => setPayOpen(false)} onDone={() => { setPayOpen(false); mutate(); }} />
      )}
    </div>
  );
}

function PaySupplierModal({ supplierId, balance, invoices, onClose, onDone }: {
  supplierId: string; balance: number;
  invoices: Array<{ id: string; number: string; total: string; paid_amount: string }>;
  onClose: () => void; onDone: () => void;
}) {
  const { t, formatMoney } = useI18n();
  const { data: methods } = useApi<{ data: Method[] }>("/payment-methods");
  const [amount, setAmount] = useState(String(balance));
  const [methodId, setMethodId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selected = invoices.find((i) => i.id === invoiceId);
  const invDue = selected ? Number(selected.total) - Number(selected.paid_amount) : null;

  async function submit() {
    setLoading(true); setErr(null);
    try {
      const amt = Number(amount);
      await apiFetch("/payments", {
        method: "POST",
        json: {
          direction: "out", partnerType: "supplier", supplierId,
          paymentMethodId: methodId, amount: amt,
          allocations: invoiceId
            ? [{ targetType: "supplier_invoice", targetId: invoiceId, amount: Math.min(amt, invDue ?? amt) }] : [],
        },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof ClientApiError ? e.message : t("common.errorGeneric"));
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("payments.supplierPayment")}>
      <div className="space-y-4">
        <Field label={t("common.amount")} required>
          <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label={t("payments.method")} required>
          <Select value={methodId} onChange={(e) => setMethodId(e.target.value)}>
            <option value="">{t("common.select")}</option>
            {methods?.data.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label={t("payments.allocateTo")} hint={t("common.optional")}>
          <Select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
            <option value="">{t("payments.unallocated")}</option>
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number} — {formatMoney(Number(i.total) - Number(i.paid_amount))}
              </option>
            ))}
          </Select>
        </Field>
        {err && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={loading} disabled={!methodId || Number(amount) <= 0} onClick={submit}>{t("common.confirm")}</Button>
        </div>
      </div>
    </Modal>
  );
}

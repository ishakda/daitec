"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Wallet } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useApi, apiFetch, useMe, ClientApiError } from "@/lib/client";
import { Button, Card, Badge, Spinner, ErrorState, Modal, Field, Input, Select, Stat, paymentTone } from "@/components/ui";
import { PartnerModal } from "@/components/PartnerPages";
import { CustomerQrCard } from "@/components/QrKit";

type Detail = {
  id: string; name: string; qr_token: string; company_name: string | null; phone: string | null; email: string | null;
  address: string | null; city: string | null; wilaya: string | null;
  nif: string | null; nis: string | null; rc: string | null; ai: string | null;
  balance?: string; credit_limit?: string | null; payment_terms_days: number | null;
  stats: { orders: number; total_purchases: string; avg_order: string; last_purchase: string | null };
  recentSales: Array<{ id: string; number: string; sale_type: string; sale_date: string; total: string; paid_amount: string; payment_status: string }>;
  recentPayments: Array<{ id: string; number: string; direction: string; amount: string; payment_date: string; method: string }>;
  topProducts: Array<{ product_id: string; description: string; qty: string; amount: string }>;
};
type Method = { id: string; name: string };

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, formatMoney, formatDate } = useI18n();
  const router = useRouter();
  const { can } = useMe();
  const { data: c, error, isLoading, mutate } = useApi<Detail>(`/customers/${id}`);
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  if (isLoading) return <Spinner label={t("common.loading")} />;
  if (error || !c) return <ErrorState message={t("common.errorGeneric")} />;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => router.push("/customers")} className="rounded-lg p-2 text-ink-3 hover:bg-surface hover:text-ink">
          <ArrowLeft size={17} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{c.name}</h1>
          <p className="text-xs text-ink-3">{[c.company_name, c.phone, c.city].filter(Boolean).join(" · ")}</p>
        </div>
        {can("payments.create") && Number(c.balance ?? 0) > 0 && (
          <Button onClick={() => setPayOpen(true)}><Wallet size={15} /> {t("payments.customerPayment")}</Button>
        )}
        {can("customers.edit") && <Button variant="secondary" onClick={() => setEditOpen(true)}>{t("common.edit")}</Button>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {c.balance != null && (
          <Stat label={t("customers.debt")} value={formatMoney(c.balance)}
            tone={Number(c.balance) > 0 ? "warn" : "ok"}
            sub={c.credit_limit != null ? `${t("customers.creditLimit")}: ${formatMoney(c.credit_limit)}` : undefined} />
        )}
        <Stat label={t("customers.totalPurchases")} value={formatMoney(c.stats.total_purchases)} />
        <Stat label={t("customers.orders")} value={<span className="num">{c.stats.orders}</span>}
          sub={`${t("customers.avgOrder")}: ${formatMoney(c.stats.avg_order)}`} />
        <Stat label={t("customers.lastPurchase")}
          value={c.stats.last_purchase ? formatDate(c.stats.last_purchase) : "—"} />
      </div>

      <Card title={t("qr.title")}>
        <CustomerQrCard token={c.qr_token} customerName={c.name} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("customers.recentSales")} pad={false}>
          <table className="w-full text-sm">
            <tbody>
              {c.recentSales.map((s) => (
                <tr key={s.id} onClick={() => router.push(`/sales/${s.id}`)}
                  className="cursor-pointer border-b border-line last:border-0 hover:bg-canvas">
                  <td className="px-4 py-2"><span className="num font-medium">{s.number}</span>
                    <br /><span className="text-xs text-ink-3">{formatDate(s.sale_date)}</span></td>
                  <td className="px-4 py-2"><Badge tone={paymentTone(s.payment_status)}>{t(`sales.${s.payment_status}`)}</Badge></td>
                  <td className="num px-4 py-2 text-end font-medium">{formatMoney(s.total)}</td>
                </tr>
              ))}
              {!c.recentSales.length && <tr><td className="px-4 py-6 text-center text-ink-3">{t("common.none")}</td></tr>}
            </tbody>
          </table>
        </Card>
        <div className="space-y-4">
          <Card title={t("customers.recentPayments")} pad={false}>
            <table className="w-full text-sm">
              <tbody>
                {c.recentPayments.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2"><span className="num text-xs text-ink-3">{p.number}</span><br />{p.method}</td>
                    <td className="px-4 py-2 text-xs text-ink-3">{formatDate(p.payment_date)}</td>
                    <td className={`num px-4 py-2 text-end font-medium ${p.direction === "out" ? "text-danger" : "text-ok"}`}>
                      {p.direction === "out" ? "−" : "+"}{formatMoney(p.amount)}
                    </td>
                  </tr>
                ))}
                {!c.recentPayments.length && <tr><td className="px-4 py-6 text-center text-ink-3">{t("common.none")}</td></tr>}
              </tbody>
            </table>
          </Card>
          <Card title={t("customers.topProducts")} pad={false}>
            <table className="w-full text-sm">
              <tbody>
                {c.topProducts.map((p, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-medium">{p.description}</td>
                    <td className="num px-4 py-2 text-end text-ink-2">×{Number(p.qty)}</td>
                    <td className="num px-4 py-2 text-end">{formatMoney(p.amount)}</td>
                  </tr>
                ))}
                {!c.topProducts.length && <tr><td className="px-4 py-6 text-center text-ink-3">{t("common.none")}</td></tr>}
              </tbody>
            </table>
          </Card>
        </div>
      </div>

      <PartnerModal kind="customers" open={editOpen} onClose={() => setEditOpen(false)}
        onDone={() => { setEditOpen(false); mutate(); }} partnerId={id}
        initial={c as unknown as Record<string, string | null>} />
      {payOpen && c.balance != null && (
        <SettleDebtModal customerId={id} balance={Number(c.balance)}
          sales={c.recentSales.filter((s) => ["unpaid", "partial"].includes(s.payment_status))}
          onClose={() => setPayOpen(false)} onDone={() => { setPayOpen(false); mutate(); }} />
      )}
    </div>
  );
}

function SettleDebtModal({ customerId, balance, sales, onClose, onDone }: {
  customerId: string; balance: number;
  sales: Array<{ id: string; number: string; total: string; paid_amount: string }>;
  onClose: () => void; onDone: () => void;
}) {
  const { t, formatMoney } = useI18n();
  const { data: methods } = useApi<{ data: Method[] }>("/payment-methods");
  const [amount, setAmount] = useState(String(balance));
  const [methodId, setMethodId] = useState("");
  const [saleId, setSaleId] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selectedSale = sales.find((s) => s.id === saleId);
  const saleDue = selectedSale ? Number(selectedSale.total) - Number(selectedSale.paid_amount) : null;

  async function submit() {
    setLoading(true); setErr(null);
    try {
      const amt = Number(amount);
      await apiFetch("/payments", {
        method: "POST",
        json: {
          direction: "in", partnerType: "customer", customerId,
          paymentMethodId: methodId, amount: amt,
          allocations: saleId ? [{ targetType: "sale", targetId: saleId, amount: Math.min(amt, saleDue ?? amt) }] : [],
        },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof ClientApiError ? e.message : t("common.errorGeneric"));
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("payments.customerPayment")}>
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
          <Select value={saleId} onChange={(e) => setSaleId(e.target.value)}>
            <option value="">{t("payments.unallocated")}</option>
            {sales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.number} — {formatMoney(Number(s.total) - Number(s.paid_amount))}
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

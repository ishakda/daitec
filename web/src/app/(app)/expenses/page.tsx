"use client";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useApi, apiFetch, useMe, ClientApiError } from "@/lib/client";
import { Button, Card, Select, Input, Field, Modal, EmptyState, TableSkeleton } from "@/components/ui";
import { DataTable, Pagination, Column } from "@/components/DataTable";

type Row = { id: string; number: string; amount: string; expense_date: string; description: string; category_name: string | null; method_name: string | null; created_by_name: string | null };
type Cat = { id: string; name: string };
type Method = { id: string; name: string };

function ExpensesInner() {
  const { t, formatMoney, formatDate } = useI18n();
  const params = useSearchParams();
  const { can } = useMe();
  const [page, setPage] = useState(1);
  const [categoryId, setCategoryId] = useState("");
  const [showNew, setShowNew] = useState(params.get("new") === "1");
  const query = new URLSearchParams({ page: String(page), limit: "25" });
  if (categoryId) query.set("categoryId", categoryId);
  const { data, isLoading, mutate } = useApi<{ data: Row[]; total: number; limit: number; sum: string }>(`/expenses?${query}`);

  const columns: Column<Row>[] = [
    { key: "expense_date", header: t("common.date"), render: (r) => formatDate(r.expense_date) },
    { key: "description", header: t("common.description"), render: (r) => (
      <div><p className="font-medium">{r.description}</p>
        <p className="text-xs text-ink-3">{r.category_name ?? "—"}{r.method_name ? ` · ${r.method_name}` : ""}</p></div>
    )},
    { key: "created_by_name", header: t("audit.user"), render: (r) => r.created_by_name ?? "—" },
    { key: "amount", header: t("common.amount"), align: "end",
      render: (r) => <span className="num font-medium text-danger">−{formatMoney(r.amount)}</span> },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{t("expenses.title")}</h1>
        <div className="flex items-center gap-3">
          {data && <span className="text-sm text-ink-2">{t("expenses.sum")}: <span className="num font-semibold text-ink">{formatMoney(data.sum)}</span></span>}
          {can("expenses.create") && <Button onClick={() => setShowNew(true)}><Plus size={15} /> {t("expenses.add")}</Button>}
        </div>
      </div>
      <Card pad={false}>
        {isLoading && !data ? <TableSkeleton /> :
          !data?.data.length ? (
            <EmptyState title={t("expenses.empty")}
              action={can("expenses.create") && <Button onClick={() => setShowNew(true)}><Plus size={15} /> {t("expenses.add")}</Button>} />
          ) : (
            <>
              <DataTable columns={columns} rows={data.data} />
              <Pagination page={page} setPage={setPage} total={data.total} limit={data.limit} />
            </>
          )}
      </Card>
      {showNew && <NewExpenseModal onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); mutate(); }} />}
    </div>
  );
}

function NewExpenseModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const { data: cats } = useApi<{ data: Cat[] }>("/expense-categories");
  const { data: methods } = useApi<{ data: Method[] }>("/payment-methods");
  const [form, setForm] = useState({ description: "", amount: "", categoryId: "", paymentMethodId: "", expenseDate: "" });
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr(null);
    try {
      await apiFetch("/expenses", {
        method: "POST",
        json: {
          description: form.description, amount: Number(form.amount),
          categoryId: form.categoryId || null, paymentMethodId: form.paymentMethodId || null,
          expenseDate: form.expenseDate || null,
        },
      });
      onDone();
    } catch (e2) {
      setErr(e2 instanceof ClientApiError ? e2.message : t("common.errorGeneric"));
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("expenses.add")}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("common.description")} required>
          <Input value={form.description} onChange={(e) => set("description", e.target.value)} autoFocus required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("common.amount")} required>
            <Input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} required />
          </Field>
          <Field label={t("common.date")}>
            <Input type="date" value={form.expenseDate} onChange={(e) => set("expenseDate", e.target.value)} />
          </Field>
          <Field label={t("expenses.category")}>
            <Select value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
              <option value="">{t("common.select")}</option>
              {cats?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label={t("payments.method")}>
            <Select value={form.paymentMethodId} onChange={(e) => set("paymentMethodId", e.target.value)}>
              <option value="">{t("common.select")}</option>
              {methods?.data.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
        </div>
        {err && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" loading={loading}>{t("common.save")}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function ExpensesPage() {
  return <Suspense><ExpensesInner /></Suspense>;
}

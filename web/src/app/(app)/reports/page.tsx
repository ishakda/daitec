"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useApi, useMe } from "@/lib/client";
import { Button, Card, Select, Input, Spinner, EmptyState, Stat } from "@/components/ui";

type ReportRow = Record<string, string | number | null>;

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

export default function ReportsPage() {
  const { t, formatMoney } = useI18n();
  const { can } = useMe();
  const [tab, setTab] = useState<"sales" | "inventory" | "debts" | "expenses">("sales");
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(today());
  const [groupBy, setGroupBy] = useState("day");
  const [invKind, setInvKind] = useState("valuation");
  const [debtSide, setDebtSide] = useState("customers");

  const salesUrl = `/reports/sales?from=${from}&to=${to}&groupBy=${groupBy}`;
  const { data: sales, isLoading: sl } = useApi<{ data: ReportRow[] }>(tab === "sales" ? salesUrl : null);
  const { data: inv, isLoading: il } = useApi<{ data: ReportRow[]; totalValue: string | null }>(
    tab === "inventory" ? `/reports/inventory?kind=${invKind}` : null);
  const { data: debts, isLoading: dl } = useApi<{ data: ReportRow[]; total: string; overdue?: string }>(
    tab === "debts" ? `/reports/debts?side=${debtSide}` : null);
  const { data: exp, isLoading: el } = useApi<{ byCategory: ReportRow[]; summary: Record<string, number> | null }>(
    tab === "expenses" ? `/reports/expenses?from=${from}&to=${to}` : null);

  const tabs = [
    ["sales", t("reports.sales")], ["inventory", t("reports.inventory")],
    ["debts", t("reports.debts")], ["expenses", t("reports.expensesReport")],
  ] as const;

  const moneyCols = new Set(["revenue", "cogs", "gross_profit", "amount", "value", "balance", "credit_limit", "stock_value"]);

  function renderTable(rows: ReportRow[]) {
    if (!rows.length) return <EmptyState title={t("common.noResults")} />;
    const cols = Object.keys(rows[0]).filter((c) => c !== "id");
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-[12px] uppercase tracking-wide text-ink-3">
              {cols.map((c) => <th key={c} className={`px-4 py-2.5 font-medium ${typeof rows[0][c] === "string" && !moneyCols.has(c) ? "text-start" : "text-end"}`}>{c.replaceAll("_", " ")}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                {cols.map((c) => (
                  <td key={c} className={`px-4 py-2 ${typeof r[c] === "string" && !moneyCols.has(c) ? "text-start" : "num text-end"}`}>
                    {r[c] == null ? "—" : moneyCols.has(c) ? formatMoney(Number(r[c])) : String(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-lg font-semibold">{t("reports.title")}</h1>
      <div className="flex gap-1 rounded-lg border border-line bg-surface p-1 w-fit">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`rounded-md px-3.5 py-1.5 text-[13px] font-medium ${tab === key ? "bg-navy text-white" : "text-ink-2 hover:bg-canvas"}`}>
            {label}
          </button>
        ))}
      </div>

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          {(tab === "sales" || tab === "expenses") && (
            <>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="max-w-[150px]" />
              <span className="text-ink-3">→</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="max-w-[150px]" />
            </>
          )}
          {tab === "sales" && (
            <>
              <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="max-w-[190px]">
                <option value="day">{t("reports.byDay")}</option>
                <option value="month">{t("reports.byMonth")}</option>
                <option value="product">{t("reports.byProduct")}</option>
                <option value="category">{t("reports.byCategory")}</option>
                <option value="employee">{t("reports.byEmployee")}</option>
                <option value="method">{t("reports.byMethod")}</option>
              </Select>
              {can("reports.export") && (
                <a href={`/api/v1${salesUrl}&format=csv`} className="ms-auto">
                  <Button variant="secondary"><Download size={14} /> {t("reports.exportCsv")}</Button>
                </a>
              )}
            </>
          )}
          {tab === "inventory" && (
            <Select value={invKind} onChange={(e) => setInvKind(e.target.value)} className="max-w-[190px]">
              <option value="valuation">{t("reports.valuation")}</option>
              <option value="low_stock">{t("reports.lowStock")}</option>
              <option value="out_of_stock">{t("reports.outOfStock")}</option>
              <option value="dead_stock">{t("reports.deadStock")}</option>
            </Select>
          )}
          {tab === "debts" && (
            <Select value={debtSide} onChange={(e) => setDebtSide(e.target.value)} className="max-w-[210px]">
              <option value="customers">{t("reports.customerDebts")}</option>
              <option value="suppliers">{t("reports.supplierDebts")}</option>
            </Select>
          )}
        </div>

        {tab === "sales" && (sl ? <Spinner /> : renderTable(sales?.data ?? []))}
        {tab === "inventory" && (il ? <Spinner /> : (
          <>
            {inv?.totalValue != null && (
              <p className="border-b border-line px-4 py-2.5 text-sm text-ink-2">
                {t("inventory.stockValue")}: <span className="num font-semibold text-ink">{formatMoney(inv.totalValue)}</span>
              </p>
            )}
            {renderTable(inv?.data ?? [])}
          </>
        ))}
        {tab === "debts" && (dl ? <Spinner /> : (
          <>
            <p className="border-b border-line px-4 py-2.5 text-sm text-ink-2">
              {t("common.total")}: <span className="num font-semibold text-ink">{formatMoney(debts?.total ?? 0)}</span>
              {debts?.overdue != null && (
                <> · {t("reports.overdueTotal")}: <span className="num font-semibold text-danger">{formatMoney(debts.overdue)}</span></>
              )}
            </p>
            {renderTable(debts?.data ?? [])}
          </>
        ))}
        {tab === "expenses" && (el ? <Spinner /> : (
          <>
            {exp?.summary && (
              <div className="grid grid-cols-2 gap-3 border-b border-line p-4 lg:grid-cols-5">
                <Stat label={t("common.revenue")} value={formatMoney(exp.summary.revenue)} />
                <Stat label={t("reports.cogs")} value={formatMoney(exp.summary.cogs)} />
                <Stat label={t("reports.grossProfit")} value={formatMoney(exp.summary.gross_profit)} tone="ok" />
                <Stat label={t("expenses.title")} value={formatMoney(exp.summary.expenses)} tone="warn" />
                <Stat label={t("reports.netEstimate")} value={formatMoney(exp.summary.net_estimate)}
                  tone={exp.summary.net_estimate >= 0 ? "ok" : "danger"} />
              </div>
            )}
            {renderTable(exp?.byCategory ?? [])}
          </>
        ))}
      </Card>
    </div>
  );
}

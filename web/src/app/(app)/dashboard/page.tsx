"use client";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { AlertTriangle, PackageX, Clock, Banknote, CheckCircle2 } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useApi } from "@/lib/client";
import { Card, Stat, Spinner, ErrorState } from "@/components/ui";

type Dash = {
  today: { sales_count: number; revenue: string; profit?: string };
  month: { sales_count: number; revenue: string; profit?: string };
  receivables: { total: string; overdue_count: number };
  payables: { total: string; due_soon_count: number };
  inventory: { value?: string; units: string };
  trend: Array<{ date: string; revenue: string; profit?: string }>;
  topProducts: Array<{ product_id: string; name: string; quantity: string; revenue: string }>;
  paymentMethods: Array<{ method: string; amount: string }>;
  alerts: { low_stock: number; out_of_stock: number; overdue_customers: number; supplier_due: number };
};

export default function DashboardPage() {
  const { t, formatMoney } = useI18n();
  const { data, error, isLoading } = useApi<Dash>("/reports/dashboard");

  if (isLoading) return <Spinner label={t("common.loading")} />;
  if (error || !data) return <ErrorState message={t("common.errorGeneric")} />;

  const alerts = [
    { n: data.alerts.low_stock, key: "dashboard.lowStock", icon: AlertTriangle, tone: "text-warn bg-warn-soft" },
    { n: data.alerts.out_of_stock, key: "dashboard.outOfStock", icon: PackageX, tone: "text-danger bg-danger-soft" },
    { n: data.alerts.overdue_customers, key: "dashboard.overdue", icon: Clock, tone: "text-warn bg-warn-soft" },
    { n: data.alerts.supplier_due, key: "dashboard.supplierDue", icon: Banknote, tone: "text-info bg-info-soft" },
  ].filter((a) => a.n > 0);

  const trend = data.trend.map((d) => ({
    date: d.date.slice(5), revenue: Number(d.revenue), profit: d.profit != null ? Number(d.profit) : undefined,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <h1 className="text-lg font-semibold">{t("dashboard.title")}</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("dashboard.todaySales")} value={formatMoney(data.today.revenue)}
          sub={`${data.today.sales_count} ${t("dashboard.salesCount")}`} />
        {data.today.profit != null && (
          <Stat label={t("dashboard.todayProfit")} value={formatMoney(data.today.profit)} tone="ok" />
        )}
        <Stat label={t("dashboard.monthRevenue")} value={formatMoney(data.month.revenue)}
          sub={`${data.month.sales_count} ${t("dashboard.salesCount")}`} />
        {data.month.profit != null && (
          <Stat label={t("dashboard.monthProfit")} value={formatMoney(data.month.profit)} tone="ok" />
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label={t("dashboard.receivables")} value={formatMoney(data.receivables.total)}
          tone={Number(data.receivables.total) > 0 ? "warn" : undefined} />
        <Stat label={t("dashboard.payables")} value={formatMoney(data.payables.total)} />
        <Stat label={t("dashboard.stockValue")}
          value={data.inventory.value != null ? formatMoney(data.inventory.value) : `${Number(data.inventory.units)}`} />
      </div>

      <Card title={t("dashboard.alerts")}>
        {alerts.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-ok"><CheckCircle2 size={16} /> {t("dashboard.allGood")}</p>
        ) : (
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.key} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium ${a.tone}`}>
                <a.icon size={15.5} /> {t(a.key, { n: a.n })}
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card title={t("dashboard.trend30")} className="lg:col-span-3">
          <div className="h-56" dir="ltr">
            <ResponsiveContainer>
              <AreaChart data={trend} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0e7569" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#0e7569" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#98a2b3" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#98a2b3" }} tickLine={false} axisLine={false} width={52}
                  tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                <Tooltip formatter={(v) => formatMoney(Number(v))} labelStyle={{ fontSize: 12 }}
                  contentStyle={{ fontSize: 13, borderRadius: 8, border: "1px solid #e4e7ec" }} />
                <Area type="monotone" dataKey="revenue" stroke="#0e7569" strokeWidth={2} fill="url(#rev)" />
                {trend.some((d) => d.profit != null) && (
                  <Area type="monotone" dataKey="profit" stroke="#1d3a5f" strokeWidth={1.5} fill="none" />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title={t("dashboard.paymentMix")} className="lg:col-span-2">
          <div className="h-56" dir="ltr">
            <ResponsiveContainer>
              <BarChart data={data.paymentMethods.map((m) => ({ ...m, amount: Number(m.amount) }))}
                margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <XAxis dataKey="method" tick={{ fontSize: 11, fill: "#98a2b3" }} tickLine={false} axisLine={false} />
                <YAxis hide />
                <Tooltip formatter={(v) => formatMoney(Number(v))}
                  contentStyle={{ fontSize: 13, borderRadius: 8, border: "1px solid #e4e7ec" }} />
                <Bar dataKey="amount" fill="#1d3a5f" radius={[4, 4, 0, 0]} maxBarSize={38} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title={t("dashboard.topProducts")} pad={false}>
        <table className="w-full text-sm">
          <tbody>
            {data.topProducts.map((p, i) => (
              <tr key={p.product_id ?? i} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 font-medium">{p.name}</td>
                <td className="num px-4 py-2.5 text-end text-ink-2">×{Number(p.quantity)}</td>
                <td className="num px-4 py-2.5 text-end font-medium">{formatMoney(p.revenue)}</td>
              </tr>
            ))}
            {data.topProducts.length === 0 && (
              <tr><td className="px-4 py-8 text-center text-ink-3">{t("common.noResults")}</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

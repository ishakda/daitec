"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/I18nProvider";
import { useApi } from "@/lib/client";
import { Badge, Select } from "@/components/ui";
import { BaseMap, FitBounds, HeatLayer, Marker, Popup, pin, dot, COLORS } from "@/components/MapKit";

type MapData = {
  branches: Array<{ id: string; name: string; address: string | null; latitude: string; longitude: string }>;
  warehouses: Array<{ id: string; name: string; latitude: string; longitude: string }>;
  customers: Array<{ id: string; name: string; phone: string | null; balance: string; latitude: string; longitude: string }>;
  deliveries: Array<{ id: string; number: string; status: string; latitude: string | null; longitude: string | null; address: string | null; cod_amount: string; customer_name: string | null; courier_name: string | null }>;
};
type Couriers = {
  data: Array<{ courier_id: string; courier_name: string; latitude: string; longitude: string; recorded_at: string; active_deliveries: number }>;
};
type RevenuePoint = { id: string; name: string; latitude: number; longitude: number; revenue: number; orders: number };
type RevenueData = { days: number; points: RevenuePoint[]; maxRevenue: number; totalRevenue: number };

export default function DispatchMap() {
  const { t, formatMoney, formatDateTime } = useI18n();
  const router = useRouter();
  const [showCustomers, setShowCustomers] = useState(true);
  const [debtOnly, setDebtOnly] = useState(false);
  const [showDeliveries, setShowDeliveries] = useState(true);
  const [showHeat, setShowHeat] = useState(false);
  const [heatDays, setHeatDays] = useState(90);

  const { data } = useApi<MapData>(`/map?withDebt=${debtOnly}`);
  const { data: couriers } = useApi<Couriers>("/courier/positions", { refreshInterval: 10000 });
  const { data: revenue } = useApi<RevenueData>(showHeat ? `/map/revenue?days=${heatDays}` : null);

  // Normalise revenue to 0..1 with a sqrt scale so a few big accounts don't
  // wash out everyone else; guarantee a visible floor for any paying customer.
  const heatPoints = useMemo<Array<[number, number, number]>>(() => {
    const max = revenue?.maxRevenue ?? 0;
    if (!showHeat || !revenue || max <= 0) return [];
    return revenue.points.map((p) => [
      p.latitude, p.longitude,
      Math.max(0.15, Math.sqrt(p.revenue / max)),
    ]);
  }, [showHeat, revenue]);

  const num = (v: string | null) => (v == null ? null : Number(v));
  const points: Array<[number, number]> = [
    ...(data?.branches ?? []).map((b) => [Number(b.latitude), Number(b.longitude)] as [number, number]),
    ...(data?.warehouses ?? []).map((w) => [Number(w.latitude), Number(w.longitude)] as [number, number]),
    ...(showCustomers ? (data?.customers ?? []) : []).map((c) => [Number(c.latitude), Number(c.longitude)] as [number, number]),
    ...(couriers?.data ?? []).map((c) => [Number(c.latitude), Number(c.longitude)] as [number, number]),
  ];

  const statusLabel = (s: string) => t(`delivery.status.${s}`);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 -m-5 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{t("map.title")}</h1>
        <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
          <input type="checkbox" checked={showCustomers} onChange={(e) => setShowCustomers(e.target.checked)} />
          {t("map.clients")}
        </label>
        <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
          <input type="checkbox" checked={debtOnly} onChange={(e) => setDebtOnly(e.target.checked)} />
          {t("map.clientsWithDebt")}
        </label>
        <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
          <input type="checkbox" checked={showDeliveries} onChange={(e) => setShowDeliveries(e.target.checked)} />
          {t("map.deliveries")}
        </label>
        <label className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
          <input type="checkbox" checked={showHeat} onChange={(e) => setShowHeat(e.target.checked)} />
          {t("map.revenueHeat")}
        </label>
        {showHeat && (
          <Select value={String(heatDays)} onChange={(e) => setHeatDays(Number(e.target.value))}
            className="!h-8 max-w-[150px] text-[13px]">
            <option value="30">{t("map.period30")}</option>
            <option value="90">{t("map.period90")}</option>
            <option value="180">{t("map.period180")}</option>
            <option value="365">{t("map.period365")}</option>
          </Select>
        )}
        <div className="ms-auto flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
          {showHeat ? (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-24 rounded-full"
                style={{ background: "linear-gradient(90deg,#2c7fb8,#41b6c4,#fed976,#fd8d3c,#e31a1c)" }} />
              <span>{t("map.heatLow")}</span>
              <span className="text-ink-3">→</span>
              <span>{t("map.heatHigh")}</span>
            </span>
          ) : (
            <>
              <LegendDot color={COLORS.store} label={t("map.stores")} />
              <LegendDot color={COLORS.customer} label={t("map.clients")} />
              <LegendDot color={COLORS.courier} label={t("map.couriers")} />
              <LegendDot color={COLORS.out_for_delivery} label={t("map.deliveries")} />
            </>
          )}
        </div>
      </div>
      {showHeat && revenue && (
        <p className="text-[12.5px] text-ink-3">
          {t("map.heatSummary", {
            total: formatMoney(revenue.totalRevenue),
            n: revenue.points.length,
          })}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-line shadow-card" dir="ltr">
        <BaseMap>
          <FitBounds points={points} />
          {showHeat && <HeatLayer points={heatPoints} />}
          {data?.branches.map((b) => (
            <Marker key={b.id} position={[Number(b.latitude), Number(b.longitude)]} icon={pin(COLORS.store, "M")}>
              <Popup><strong>{b.name}</strong><br />{b.address}</Popup>
            </Marker>
          ))}
          {data?.warehouses.map((w) => (
            <Marker key={w.id} position={[Number(w.latitude), Number(w.longitude)]} icon={pin(COLORS.warehouse, "D")}>
              <Popup><strong>{w.name}</strong></Popup>
            </Marker>
          ))}
          {showCustomers && data?.customers.map((c) => (
            <Marker key={c.id}
              position={[Number(c.latitude), Number(c.longitude)]}
              icon={dot(Number(c.balance) > 0 ? COLORS.debt : COLORS.customer)}>
              <Popup>
                <strong>{c.name}</strong>
                {c.phone && <><br />{c.phone}</>}
                {Number(c.balance) > 0 && <><br />{t("customers.debt")}: {formatMoney(c.balance)}</>}
                <br /><a href={`/customers/${c.id}`}>→</a>
              </Popup>
            </Marker>
          ))}
          {showDeliveries && data?.deliveries.filter((d) => num(d.latitude) != null).map((d) => (
            <Marker key={d.id}
              position={[Number(d.latitude), Number(d.longitude)]}
              icon={pin((COLORS as Record<string, string>)[d.status] ?? COLORS.pending, "▲")}>
              <Popup>
                <strong>{d.number}</strong> — {statusLabel(d.status)}<br />
                {d.customer_name}<br />
                {d.courier_name && <>{t("delivery.courier")}: {d.courier_name}<br /></>}
                {Number(d.cod_amount) > 0 && <>{t("delivery.codShort")}: {formatMoney(d.cod_amount)}<br /></>}
                <button onClick={() => router.push(`/deliveries`)} style={{ color: "#0e7569" }}>→</button>
              </Popup>
            </Marker>
          ))}
          {couriers?.data.map((c) => (
            <Marker key={c.courier_id} position={[Number(c.latitude), Number(c.longitude)]} icon={pin(COLORS.courier, "🛵")}>
              <Popup>
                <strong>{c.courier_name}</strong><br />
                {c.active_deliveries} {t("map.activeDeliveries")}<br />
                {t("map.lastSeen")}: {formatDateTime(c.recorded_at)}
              </Popup>
            </Marker>
          ))}
        </BaseMap>
      </div>

      {(couriers?.data.length ?? 0) === 0 && (
        <p className="text-[13px] text-ink-3">
          {t("map.noPositions")} <Badge tone="neutral">/courier</Badge>
        </p>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} /> {label}
    </span>
  );
}

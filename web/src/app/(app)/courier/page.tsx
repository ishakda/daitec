"use client";
import { useState, useEffect, useRef } from "react";
import { MapPin, Phone, Navigation, PackageCheck, Truck, XCircle } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useApi, apiFetch, ClientApiError } from "@/lib/client";
import { Button, Badge, Modal, Field, Input, Spinner, Stat } from "@/components/ui";
import { PodModal, Proof } from "@/components/ProofOfDelivery";

/**
 * Livreur mobile page: worklist + status updates + GPS pings while on duty.
 * Designed phone-first (large touch targets, single column).
 */

type Delivery = {
  id: string; number: string; status: string; address: string | null; city: string | null;
  phone: string | null; latitude: string | null; longitude: string | null;
  cod_amount: string; notes: string | null; customer_name: string | null; sale_number: string | null;
};
type MeResp = { data: Delivery[]; today: { delivered_today: number; cod_today: string } };

const NEXT_ACTIONS: Record<string, Array<{ status: string; key: string; icon: typeof Truck; primary?: boolean }>> = {
  assigned: [
    { status: "picked_up", key: "delivery.markPickedUp", icon: PackageCheck, primary: true },
    { status: "out_for_delivery", key: "delivery.markOut", icon: Truck },
  ],
  picked_up: [
    { status: "out_for_delivery", key: "delivery.markOut", icon: Truck, primary: true },
    { status: "delivered", key: "delivery.markDelivered", icon: PackageCheck },
  ],
  out_for_delivery: [
    { status: "delivered", key: "delivery.markDelivered", icon: PackageCheck, primary: true },
  ],
};

export default function CourierPage() {
  const { t, formatMoney } = useI18n();
  const { data, isLoading, mutate } = useApi<MeResp>("/courier/me", { refreshInterval: 30000 });
  const [onDuty, setOnDuty] = useState(false);
  const [gpsError, setGpsError] = useState(false);
  const [failFor, setFailFor] = useState<Delivery | null>(null);
  const [podFor, setPodFor] = useState<Delivery | null>(null);
  const watchRef = useRef<number | null>(null);
  const lastPing = useRef(0);

  // GPS pings while on duty (~20s throttle)
  useEffect(() => {
    if (!onDuty) {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
      return;
    }
    if (!navigator.geolocation) { setGpsError(true); setOnDuty(false); return; }
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsError(false);
        const now = Date.now();
        if (now - lastPing.current < 20000) return;
        lastPing.current = now;
        apiFetch("/courier/ping", {
          method: "POST",
          json: {
            latitude: pos.coords.latitude, longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null,
            heading: pos.coords.heading != null && !isNaN(pos.coords.heading) ? pos.coords.heading : null,
          },
        }).catch(() => {});
      },
      () => { setGpsError(true); setOnDuty(false); },
      { enableHighAccuracy: true, maximumAge: 15000 }
    );
    return () => { if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current); };
  }, [onDuty]);

  async function setStatus(d: Delivery, status: string, failureReason?: string, proofs: Proof[] = [], qrToken?: string | null) {
    try {
      await apiFetch(`/deliveries/${d.id}/status`, {
        method: "POST", json: { status, failureReason, proofs, qrToken: qrToken ?? null },
      });
      mutate();
    } catch (e) {
      alert(e instanceof ClientApiError ? e.message : t("common.errorGeneric"));
    }
  }

  if (isLoading) return <Spinner label={t("common.loading")} />;

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-10">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{t("delivery.myDeliveries")}</h1>
        <button
          onClick={() => setOnDuty((v) => !v)}
          className={`flex items-center gap-2 rounded-full border px-4 py-2 text-[13.5px] font-semibold transition-colors
            ${onDuty ? "border-ok bg-ok-soft text-ok" : "border-line-2 bg-surface text-ink-2"}`}
        >
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${onDuty ? "animate-pulse bg-ok" : "bg-ink-3"}`} />
          {onDuty ? t("delivery.onDuty") : t("delivery.offDuty")}
        </button>
      </div>
      {gpsError && <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">{t("delivery.gpsDenied")}</p>}

      <div className="grid grid-cols-2 gap-3">
        <Stat label={t("delivery.deliveredToday")} value={<span className="num">{data?.today.delivered_today ?? 0}</span>} tone="ok" />
        <Stat label={t("delivery.codToday")} value={formatMoney(data?.today.cod_today ?? 0)} />
      </div>

      {!data?.data.length ? (
        <p className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-ink-3">
          {t("delivery.noneAssigned")}
        </p>
      ) : (
        data.data.map((d) => (
          <div key={d.id} className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="num text-[15px] font-semibold">{d.number}</p>
                <p className="text-sm font-medium">{d.customer_name ?? "—"}</p>
                {d.address && (
                  <p className="mt-0.5 flex items-center gap-1 text-[13px] text-ink-2">
                    <MapPin size={13} /> {d.address}{d.city ? `, ${d.city}` : ""}
                  </p>
                )}
                {d.notes && <p className="mt-1 text-[12.5px] italic text-ink-3">{d.notes}</p>}
              </div>
              <Badge tone={d.status === "out_for_delivery" ? "info" : "warn"}>
                {t(`delivery.status.${d.status}`)}
              </Badge>
            </div>

            {Number(d.cod_amount) > 0 && (
              <p className="mt-2 rounded-lg bg-warn-soft px-3 py-1.5 text-[13.5px] font-semibold text-warn">
                {t("delivery.codShort")}: <span className="num">{formatMoney(d.cod_amount)}</span>
              </p>
            )}

            <div className="mt-3 flex gap-2">
              {d.phone && (
                <a href={`tel:${d.phone}`} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line-2 text-[13.5px] font-medium text-ink-2">
                  <Phone size={15} /> {t("delivery.call")}
                </a>
              )}
              {d.latitude && d.longitude && (
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${d.latitude},${d.longitude}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line-2 text-[13.5px] font-medium text-ink-2">
                  <Navigation size={15} /> {t("delivery.navigate")}
                </a>
              )}
            </div>

            <div className="mt-2 flex gap-2">
              {(NEXT_ACTIONS[d.status] ?? []).map((a) => (
                <Button key={a.status}
                  variant={a.primary ? "primary" : "secondary"}
                  className="h-11 flex-1"
                  onClick={() => a.status === "delivered" ? setPodFor(d) : setStatus(d, a.status)}>
                  <a.icon size={16} /> {t(a.key)}
                </Button>
              ))}
              <Button variant="ghost" className="h-11 px-3" onClick={() => setFailFor(d)}>
                <XCircle size={16} className="text-danger" />
              </Button>
            </div>
          </div>
        ))
      )}

      {failFor && (
        <FailModal delivery={failFor} onClose={() => setFailFor(null)}
          onConfirm={async (reason) => { await setStatus(failFor, "failed", reason); setFailFor(null); }} />
      )}
      {podFor && (
        <PodModal number={podFor.number} deliveryId={podFor.id} hasCustomer={!!podFor.customer_name}
          onClose={() => setPodFor(null)}
          onConfirm={async (proofs, qrToken) => {
            await setStatus(podFor, "delivered", undefined, proofs, qrToken);
            setPodFor(null);
          }} />
      )}
    </div>
  );
}

function FailModal({ delivery, onClose, onConfirm }: {
  delivery: Delivery; onClose: () => void; onConfirm: (reason: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  return (
    <Modal open onClose={onClose} title={`${t("delivery.markFailed")} — ${delivery.number}`}>
      <div className="space-y-4">
        <Field label={t("delivery.failureReason")} required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="danger" loading={loading} disabled={!reason.trim()}
            onClick={async () => { setLoading(true); await onConfirm(reason.trim()); }}>
            {t("common.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

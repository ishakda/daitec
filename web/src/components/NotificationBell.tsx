"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Bell, AlertTriangle, PackageX, Clock, Banknote, XCircle, CheckCheck, Info } from "lucide-react";
import { useI18n } from "./I18nProvider";
import { useApi, apiFetch } from "@/lib/client";

type Notif = {
  id: string; severity: "critical" | "warning" | "info" | "success";
  kind: string; title: string; body: string | null;
  entity_type: string | null; entity_id: string | null;
  read_at: string | null; created_at: string;
};

const KIND_ICON: Record<string, typeof Bell> = {
  low_stock: AlertTriangle, out_of_stock: PackageX,
  overdue_customer: Clock, supplier_due: Banknote, delivery_failed: XCircle,
};
const SEV_TONE: Record<string, string> = {
  critical: "bg-danger-soft text-danger", warning: "bg-warn-soft text-warn",
  info: "bg-info-soft text-info", success: "bg-ok-soft text-ok",
};

function routeFor(n: Notif): string | null {
  switch (n.entity_type) {
    case "product": return n.entity_id ? `/products/${n.entity_id}` : "/products";
    case "sale": return n.entity_id ? `/sales/${n.entity_id}` : "/sales";
    case "supplier_invoice": return "/purchases?tab=invoices";
    case "delivery": return "/deliveries";
    default: return null;
  }
}

export function NotificationBell() {
  const { t, formatMoney, formatDateTime } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Poll unread count every 60s; full list refresh when opened.
  const { data, mutate } = useApi<{ data: Notif[]; unread: number }>(
    "/notifications?limit=30", { refreshInterval: 60000 });

  useEffect(() => {
    if (!open) return;
    mutate();
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, mutate]);

  const unread = data?.unread ?? 0;

  function render(n: Notif): string {
    let s = t(`notif.${n.kind}`, { label: n.title, detail: n.body ?? "" });
    if (["overdue_customer", "supplier_due"].includes(n.kind) && n.body) {
      s += ` · ${formatMoney(n.body)}`;
    }
    return s;
  }

  async function openItem(n: Notif) {
    if (!n.read_at) {
      apiFetch("/notifications/read", { method: "POST", json: { ids: [n.id] } })
        .then(() => mutate()).catch(() => {});
    }
    const route = routeFor(n);
    if (route) { setOpen(false); router.push(route); }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-ink-2 hover:bg-canvas hover:text-ink"
        aria-label={t("notif.title")}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="num absolute -end-0.5 -top-0.5 flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute end-0 top-11 z-50 w-[380px] overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h3 className="text-sm font-semibold">{t("notif.title")}</h3>
            {unread > 0 && (
              <button
                onClick={async () => {
                  await apiFetch("/notifications/read", { method: "POST", json: { all: true } });
                  mutate();
                }}
                className="flex items-center gap-1 text-[12.5px] text-accent hover:underline"
              >
                <CheckCheck size={13} /> {t("notif.markAllRead")}
              </button>
            )}
          </div>
          <div className="scroll-thin max-h-[420px] overflow-y-auto">
            {!data?.data.length ? (
              <p className="px-4 py-10 text-center text-[13px] text-ink-3">{t("notif.empty")}</p>
            ) : (
              data.data.map((n) => {
                const Icon = KIND_ICON[n.kind] ?? Info;
                return (
                  <button
                    key={n.id}
                    onClick={() => openItem(n)}
                    className={`flex w-full items-start gap-2.5 border-b border-line px-4 py-2.5 text-start last:border-0
                      hover:bg-canvas ${n.read_at ? "opacity-55" : ""}`}
                  >
                    <span className={`mt-0.5 rounded-lg p-1.5 ${SEV_TONE[n.severity] ?? SEV_TONE.info}`}>
                      <Icon size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium leading-snug">{render(n)}</span>
                      <span className="text-[11.5px] text-ink-3">{formatDateTime(n.created_at)}</span>
                    </span>
                    {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

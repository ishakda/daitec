"use client";
import { ReactNode, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, ShoppingCart, Package, Boxes, Receipt, FileText, Truck,
  Users, Factory, Wallet, Coins, BarChart3, ScrollText, Settings, LogOut, Menu, Search,
  Map as MapIcon, Bike, ShieldCheck,
} from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useMe, apiFetch } from "@/lib/client";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { CommandPalette } from "@/components/CommandPalette";
import { NotificationBell } from "@/components/NotificationBell";
import { Spinner } from "@/components/ui";

const NAV = [
  { href: "/dashboard", key: "nav.dashboard", icon: LayoutDashboard, perm: "dashboard.view" },
  { href: "/pos", key: "nav.pos", icon: ShoppingCart, perm: "pos.use" },
  { href: "/products", key: "nav.products", icon: Package, perm: "products.view" },
  { href: "/inventory", key: "nav.inventory", icon: Boxes, perm: "inventory.view" },
  { href: "/sales", key: "nav.sales", icon: Receipt, perm: "sales.view" },
  { href: "/quotations", key: "nav.quotations", icon: FileText, perm: "sales.view" },
  { href: "/purchases", key: "nav.purchases", icon: Truck, perm: "purchases.view" },
  { href: "/deliveries", key: "nav.deliveries", icon: Bike, perm: "deliveries.assign" },
  { href: "/map", key: "nav.map", icon: MapIcon, perm: "map.view" },
  { href: "/courier", key: "nav.courier", icon: Bike, perm: "deliveries.update_status" },
  { href: "/customers", key: "nav.customers", icon: Users, perm: "customers.view" },
  { href: "/suppliers", key: "nav.suppliers", icon: Factory, perm: "suppliers.view" },
  { href: "/payments", key: "nav.payments", icon: Wallet, perm: "payments.view" },
  { href: "/expenses", key: "nav.expenses", icon: Coins, perm: "expenses.view" },
  { href: "/reports", key: "nav.reports", icon: BarChart3, perm: "reports.view" },
  { href: "/audit", key: "nav.audit", icon: ScrollText, perm: "audit.view" },
  { href: "/settings", key: "nav.settings", icon: Settings, perm: "settings.manage" },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const { data: me, isLoading, can } = useMe();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    if (!isLoading && me && !me.activeCompanyId) router.replace("/onboarding");
  }, [isLoading, me, router]);

  if (isLoading) return <Spinner label={t("common.loading")} />;
  if (!me) return null;

  const company = me.companies.find((c) => c.id === me.activeCompanyId);
  const isPos = pathname.startsWith("/pos");

  async function logout() {
    await apiFetch("/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const nav = NAV.filter((n) => can(n.perm));

  const sidebar = (
    <aside className="flex h-full w-60 flex-col bg-navy text-white">
      <div className="flex items-center gap-2 px-5 pb-4 pt-5">
        <span className="text-lg font-bold tracking-tight">Daitec</span>
        <span className="mt-0.5 truncate text-xs text-white/50">{company?.name}</span>
      </div>
      <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-3">
        {nav.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors
                ${active ? "bg-white/12 text-white" : "text-white/65 hover:bg-white/8 hover:text-white"}`}
            >
              <Icon size={16.5} strokeWidth={2} />
              {t(item.key)}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-3">
        {me.isPlatformAdmin && (
          <Link href="/admin"
            className="mb-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium text-emerald-300/90 hover:bg-white/8 hover:text-emerald-200">
            <ShieldCheck size={16.5} /> Console plateforme
          </Link>
        )}
        <div className="mb-2 px-2 text-xs text-white/50">{me.user.fullName}</div>
        <button onClick={logout}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium text-white/65 hover:bg-white/8 hover:text-white">
          <LogOut size={16.5} /> {t("common.logout")}
        </button>
      </div>
    </aside>
  );

  if (isPos) {
    // POS gets a distraction-free full-screen layout.
    return (
      <>
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        {children}
      </>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden lg:block">{sidebar}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-navy/50" />
          <div className="absolute inset-y-0 start-0" onClick={(e) => e.stopPropagation()}>{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-line bg-surface px-4">
          <button className="rounded-lg p-2 text-ink-2 hover:bg-canvas lg:hidden" onClick={() => setMobileOpen(true)}>
            <Menu size={18} />
          </button>
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 flex-1 max-w-md items-center gap-2 rounded-lg border border-line-2 bg-canvas px-3 text-[13px] text-ink-3 hover:border-accent"
          >
            <Search size={14.5} /> {t("common.search")}
            <kbd className="ms-auto rounded border border-line-2 bg-surface px-1.5 py-0.5 text-[10.5px] text-ink-3">Ctrl K</kbd>
          </button>
          <div className="ms-auto flex items-center gap-1.5">
            <NotificationBell />
            <LocaleSwitcher compact />
          </div>
        </header>
        <main className="scroll-thin flex-1 overflow-y-auto p-5">{children}</main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

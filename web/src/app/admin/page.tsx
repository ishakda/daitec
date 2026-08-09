"use client";
import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, ArrowLeft, Building2, Users, Receipt, TrendingUp, Ban, CheckCircle2 } from "lucide-react";
import { useApi, apiFetch, useMe, ClientApiError } from "@/lib/client";
import { useI18n } from "@/components/I18nProvider";
import { Button, Card, Badge, Input, Field, Modal, Spinner, Stat, TableSkeleton } from "@/components/ui";

/**
 * Platform Super Admin console — operator back-office.
 * Server-guarded by withPlatformAdmin (privileged pool); this page
 * additionally hides itself from non-admins.
 */

type Overview = {
  companies: { total: number; suspended: number; new_30d: number };
  users: { total: number; new_30d: number };
  sales: { sales_today: number; revenue_today: string; sales_30d: number; revenue_30d: string };
  topCompanies: Array<{ id: string; name: string; revenue_30d: string; sales_30d: number }>;
};
type CompanyRow = {
  id: string; name: string; city: string | null; wilaya: string | null; activity: string | null;
  created_at: string; suspended_at: string | null; suspension_reason: string | null;
  owner_email: string | null; members: number; products: number;
  sales_30d: number; revenue_30d: string; last_activity: string | null;
};
type AuditRow = {
  id: number; action: string; company_name: string | null; details: Record<string, unknown> | null;
  created_at: string; admin_name: string; admin_email: string;
};

export default function AdminConsole() {
  const { formatMoney, formatDateTime, formatDate } = useI18n();
  const { data: me, isLoading: meLoading } = useMe();
  const [tab, setTab] = useState<"companies" | "audit">("companies");
  const [q, setQ] = useState("");
  const [suspendFor, setSuspendFor] = useState<CompanyRow | null>(null);

  const { data: overview } = useApi<Overview>(me?.isPlatformAdmin ? "/admin/overview" : null);
  const { data: companies, isLoading: cLoading, mutate } =
    useApi<{ data: CompanyRow[] }>(me?.isPlatformAdmin ? `/admin/companies?q=${encodeURIComponent(q)}` : null);
  const { data: audit } = useApi<{ data: AuditRow[] }>(
    me?.isPlatformAdmin && tab === "audit" ? "/admin/audit" : null);

  if (meLoading) return <Spinner />;
  if (!me?.isPlatformAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="rounded-xl border border-line bg-surface p-8 text-center">
          <p className="text-sm font-medium text-ink">Accès réservé à l&apos;administrateur plateforme.</p>
          <Link href="/dashboard" className="mt-3 inline-block text-sm text-accent hover:underline">← Retour</Link>
        </div>
      </div>
    );
  }

  async function activate(c: CompanyRow) {
    await apiFetch(`/admin/companies/${c.id}/activate`, { method: "POST" });
    mutate();
  }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="flex h-14 items-center gap-3 border-b border-line bg-navy px-5 text-white">
        <ShieldCheck size={19} className="text-emerald-300" />
        <span className="font-semibold">Daitec — Console plateforme</span>
        <Badge tone="warn">SUPER ADMIN</Badge>
        <Link href="/dashboard" className="ms-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-white/70 hover:bg-white/10 hover:text-white">
          <ArrowLeft size={14} /> Application
        </Link>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 p-5">
        {overview && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Entreprises" value={<span className="num">{overview.companies.total}</span>}
              sub={`+${overview.companies.new_30d} sur 30j · ${overview.companies.suspended} suspendue(s)`} />
            <Stat label="Utilisateurs" value={<span className="num">{overview.users.total}</span>}
              sub={`+${overview.users.new_30d} sur 30j`} />
            <Stat label="Ventes (30j, toutes entreprises)" value={<span className="num">{overview.sales.sales_30d}</span>}
              sub={`${overview.sales.sales_today} aujourd'hui`} />
            <Stat label="Volume (30j)" value={formatMoney(overview.sales.revenue_30d)} tone="ok"
              sub={`${formatMoney(overview.sales.revenue_today)} aujourd'hui`} />
          </div>
        )}

        <div className="flex gap-1 rounded-lg border border-line bg-surface p-1 w-fit">
          {([["companies", "Entreprises", Building2], ["audit", "Journal plateforme", Receipt]] as const).map(([key, label, Icon]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[13px] font-medium ${tab === key ? "bg-navy text-white" : "text-ink-2 hover:bg-canvas"}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {tab === "companies" && (
          <Card pad={false}>
            <div className="border-b border-line p-3">
              <Input placeholder="Rechercher une entreprise…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
            </div>
            {cLoading && !companies ? <TableSkeleton /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-[12px] uppercase tracking-wide text-ink-3">
                      <th className="px-4 py-2.5 text-start font-medium">Entreprise</th>
                      <th className="px-4 py-2.5 text-start font-medium">Propriétaire</th>
                      <th className="px-4 py-2.5 text-end font-medium"><Users size={13} className="inline" /></th>
                      <th className="px-4 py-2.5 text-end font-medium">Produits</th>
                      <th className="px-4 py-2.5 text-end font-medium"><TrendingUp size={13} className="inline" /> 30j</th>
                      <th className="px-4 py-2.5 text-start font-medium">Dern. activité</th>
                      <th className="px-4 py-2.5 text-start font-medium">Statut</th>
                      <th className="px-4 py-2.5 text-end font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {companies?.data.map((c) => (
                      <tr key={c.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-2.5">
                          <p className="font-medium">{c.name}</p>
                          <p className="text-xs text-ink-3">
                            {[c.activity, c.wilaya].filter(Boolean).join(" · ")} · créée {formatDate(c.created_at)}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-[13px] text-ink-2">{c.owner_email ?? "—"}</td>
                        <td className="num px-4 py-2.5 text-end">{c.members}</td>
                        <td className="num px-4 py-2.5 text-end">{c.products}</td>
                        <td className="num px-4 py-2.5 text-end">
                          <p className="font-medium">{formatMoney(c.revenue_30d)}</p>
                          <p className="text-xs text-ink-3">{c.sales_30d} ventes</p>
                        </td>
                        <td className="px-4 py-2.5 text-[13px] text-ink-3">
                          {c.last_activity ? formatDateTime(c.last_activity) : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          {c.suspended_at ? (
                            <div>
                              <Badge tone="danger">Suspendue</Badge>
                              {c.suspension_reason && <p className="mt-0.5 max-w-[160px] text-xs text-ink-3">{c.suspension_reason}</p>}
                            </div>
                          ) : (
                            <Badge tone="ok">Active</Badge>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-end">
                          {c.suspended_at ? (
                            <Button variant="secondary" className="h-8 text-xs" onClick={() => activate(c)}>
                              <CheckCircle2 size={13} /> Réactiver
                            </Button>
                          ) : (
                            <Button variant="ghost" className="h-8 text-xs text-danger" onClick={() => setSuspendFor(c)}>
                              <Ban size={13} /> Suspendre
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {tab === "audit" && (
          <Card pad={false}>
            <table className="w-full text-sm">
              <tbody>
                {audit?.data.map((a) => (
                  <tr key={a.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 text-[13px] text-ink-3">{formatDateTime(a.created_at)}</td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{a.admin_name}</p>
                      <p className="text-xs text-ink-3">{a.admin_email}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={a.action.startsWith("suspend") ? "danger" : "ok"}>{a.action}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-[13px]">{a.company_name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-ink-3" dir="ltr">
                      {a.details ? JSON.stringify(a.details) : ""}
                    </td>
                  </tr>
                ))}
                {!audit?.data.length && (
                  <tr><td className="px-4 py-8 text-center text-ink-3">Aucune action enregistrée.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        )}
      </main>

      {suspendFor && (
        <SuspendModal company={suspendFor} onClose={() => setSuspendFor(null)}
          onDone={() => { setSuspendFor(null); mutate(); }} />
      )}
    </div>
  );
}

function SuspendModal({ company, onClose, onDone }: {
  company: CompanyRow; onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={`Suspendre — ${company.name}`}>
      <div className="space-y-4">
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
          Les utilisateurs de cette entreprise ne pourront plus accéder à leurs données
          tant que la suspension est active. Aucune donnée n&apos;est supprimée.
        </p>
        <Field label="Motif" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
            placeholder="Impayé, abus, demande du client…" />
        </Field>
        {err && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button variant="danger" loading={loading} disabled={reason.trim().length < 3}
            onClick={async () => {
              setLoading(true); setErr(null);
              try {
                await apiFetch(`/admin/companies/${company.id}/suspend`, {
                  method: "POST", json: { reason: reason.trim() },
                });
                onDone();
              } catch (e) {
                setErr(e instanceof ClientApiError ? e.message : "Erreur");
                setLoading(false);
              }
            }}>
            Suspendre
          </Button>
        </div>
      </div>
    </Modal>
  );
}

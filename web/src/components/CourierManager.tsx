"use client";
/**
 * One-stop courier management, embedded right where deliveries live.
 * Add a livreur in seconds (auto-generated password, Livreur role picked
 * automatically) and get a printable credentials card to hand over.
 */
import { useState } from "react";
import { Bike, Plus, Copy, Printer, CheckCircle2 } from "lucide-react";
import { useI18n } from "./I18nProvider";
import { useApi, apiFetch, ClientApiError } from "@/lib/client";
import { mutate as globalMutate } from "swr";
import { Button, Input, Field, Modal, Badge } from "./ui";

type Member = { id: string; user_id: string; full_name: string; email: string; role_name: string; status: string };
type Role = { id: string; name: string };
type Position = { courier_id: string; active_deliveries: number; recorded_at: string };

function genPassword(): string {
  const digits = () => Math.floor(1000 + Math.random() * 9000);
  return `dz${digits()}${digits()}`;
}

export function CourierManagerButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Bike size={15} /> {t("livreur.manage")}
      </Button>
      {open && <CourierManagerModal onClose={() => setOpen(false)} />}
    </>
  );
}

function CourierManagerModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { data: members, mutate } = useApi<{ data: Member[] }>("/members");
  const { data: roles } = useApi<{ data: Role[] }>("/roles");
  const { data: positions } = useApi<{ data: Position[] }>("/courier/positions");
  const [adding, setAdding] = useState(false);
  const [creds, setCreds] = useState<{ name: string; email: string; password: string } | null>(null);

  const livreurs = (members?.data ?? []).filter((m) => m.role_name === "Livreur" && m.status === "active");
  const activeOf = (userId: string) =>
    positions?.data.find((p) => p.courier_id === userId)?.active_deliveries ?? 0;

  return (
    <Modal open onClose={onClose} title={t("livreur.list")} wide>
      {creds ? (
        <CredentialsCard creds={creds} onDone={() => setCreds(null)} />
      ) : adding ? (
        <AddCourierForm
          roles={roles?.data ?? []}
          onCancel={() => setAdding(false)}
          onCreated={(c) => {
            setAdding(false); setCreds(c); mutate();
            globalMutate("/map"); // refresh courier dropdowns everywhere
            globalMutate("/courier/positions");
          }}
        />
      ) : (
        <div className="space-y-3">
          {livreurs.length === 0 ? (
            <p className="rounded-lg bg-canvas px-4 py-8 text-center text-[13.5px] text-ink-3">
              {t("livreur.none")}
            </p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {livreurs.map((m) => (
                  <tr key={m.id} className="border-b border-line last:border-0">
                    <td className="py-2.5 pe-3">
                      <p className="font-medium">{m.full_name}</p>
                      <p className="text-xs text-ink-3">{m.email}</p>
                    </td>
                    <td className="py-2.5 text-end">
                      <Badge tone={activeOf(m.user_id) > 0 ? "info" : "neutral"}>
                        {t("livreur.activeCount", { n: activeOf(m.user_id) })}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Button className="h-11 w-full" onClick={() => setAdding(true)}>
            <Plus size={16} /> {t("livreur.add")}
          </Button>
        </div>
      )}
    </Modal>
  );
}

function AddCourierForm({ roles, onCancel, onCreated }: {
  roles: Role[];
  onCancel: () => void;
  onCreated: (c: { name: string; email: string; password: string }) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(genPassword());
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function suggestedEmail(n: string): string {
    const slug = n.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
    return slug ? `${slug}@livreur.daitec` : "";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr(null);
    try {
      const livreurRole = roles.find((r) => r.name === "Livreur");
      if (!livreurRole) throw new Error("no role");
      const finalEmail = (email || suggestedEmail(name)).toLowerCase();
      await apiFetch("/members", {
        method: "POST",
        json: { email: finalEmail, fullName: name.trim(), password, roleId: livreurRole.id },
      });
      onCreated({ name: name.trim(), email: finalEmail, password });
    } catch (e2) {
      setErr(e2 instanceof ClientApiError ? e2.message : t("common.errorGeneric"));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t("livreur.name")} required>
        <Input value={name} autoFocus required minLength={2}
          onChange={(e) => { setName(e.target.value); if (!email) setEmail(""); }}
          placeholder="Sofiane B." />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("common.phone")} hint={t("common.optional")}>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0550 12 34 56" />
        </Field>
        <Field label={t("common.email")} hint={name ? suggestedEmail(name) : undefined}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder={name ? suggestedEmail(name) : "sofiane@…"} />
        </Field>
      </div>
      <Field label={t("auth.password")}>
        <div className="flex gap-2">
          <Input value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          <Button type="button" variant="secondary" onClick={() => setPassword(genPassword())}>
            {t("livreur.genPassword")}
          </Button>
        </div>
      </Field>
      {err && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t("common.cancel")}</Button>
        <Button type="submit" loading={loading} disabled={!name.trim() || password.length < 8}>
          <Plus size={15} /> {t("livreur.add")}
        </Button>
      </div>
    </form>
  );
}

function CredentialsCard({ creds, onDone }: {
  creds: { name: string; email: string; password: string };
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const loginUrl = typeof window !== "undefined" ? window.location.origin : "";
  const text = `${t("livreur.loginAddr")}: ${loginUrl}\n${t("common.email")}: ${creds.email}\n${t("auth.password")}: ${creds.password}`;

  function print() {
    const w = window.open("", "_blank", "width=440,height=560");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Livreur</title><style>
      body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:94vh;margin:0}
      .card{border:1.5px solid #14263f;border-radius:14px;padding:26px 30px;width:320px}
      h2{margin:0;font-size:17px;color:#14263f} p{font-size:12px;color:#667085;margin:6px 0 16px}
      .row{margin:9px 0} .k{font-size:11px;text-transform:uppercase;color:#98a2b3;letter-spacing:.04em}
      .v{font-size:15px;font-weight:600;color:#101828;font-family:ui-monospace,monospace}
      </style></head><body><div class="card">
      <h2>Daitec — ${creds.name.replace(/</g, "&lt;")}</h2>
      <p>${t("livreur.credsHint")}</p>
      <div class="row"><div class="k">${t("livreur.loginAddr")}</div><div class="v">${loginUrl}</div></div>
      <div class="row"><div class="k">${t("common.email")}</div><div class="v">${creds.email}</div></div>
      <div class="row"><div class="k">${t("auth.password")}</div><div class="v">${creds.password}</div></div>
      </div><script>setTimeout(()=>window.print(),200)</script></body></html>`);
    w.document.close();
  }

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 rounded-lg bg-ok-soft px-3 py-2.5 text-[13.5px] font-semibold text-ok">
        <CheckCircle2 size={17} /> {t("livreur.created")} — {creds.name}
      </p>
      <div className="rounded-xl border border-line bg-canvas p-4">
        <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">{t("livreur.credsTitle")}</p>
        <p className="mb-3 text-[12.5px] text-ink-3">{t("livreur.credsHint")}</p>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-ink-2">{t("livreur.loginAddr")}</dt><dd className="num font-medium">{loginUrl}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-2">{t("common.email")}</dt><dd className="num font-medium">{creds.email}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-2">{t("auth.password")}</dt><dd className="num font-semibold">{creds.password}</dd></div>
        </dl>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={async () => {
          await navigator.clipboard.writeText(text).catch(() => {});
          setCopied(true); setTimeout(() => setCopied(false), 1800);
        }}>
          <Copy size={14} /> {copied ? t("livreur.copied") : t("livreur.copy")}
        </Button>
        <Button variant="secondary" className="flex-1" onClick={print}>
          <Printer size={14} /> {t("livreur.printCard")}
        </Button>
        <Button className="flex-1" onClick={onDone}>{t("common.close")}</Button>
      </div>
    </div>
  );
}

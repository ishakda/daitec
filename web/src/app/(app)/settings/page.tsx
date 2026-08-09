"use client";
import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useApi, apiFetch, ClientApiError } from "@/lib/client";
import { Button, Card, Badge, Input, Select, Field, Modal, Spinner } from "@/components/ui";

type Company = Record<string, string | null>;
type Member = { id: string; user_id: string; full_name: string; email: string; role_id: string; role_name: string; is_owner: boolean; status: string };
type Role = { id: string; name: string; description: string | null; is_system: boolean; permissions: string[]; member_count: number };
type PermDef = { code: string; module: string; description: string };
type Warehouse = { id: string; name: string; is_default: boolean; is_active: boolean };
type Method = { id: string; name: string; code: string; kind: string; is_active: boolean };

export default function SettingsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"business" | "users" | "warehouses" | "methods" | "receipt">("business");
  const tabs = [
    ["business", t("settings.business")], ["users", t("settings.usersRoles")],
    ["warehouses", t("settings.warehouses")], ["methods", t("settings.paymentMethods")],
    ["receipt", t("receipt.settings")],
  ] as const;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-lg font-semibold">{t("settings.title")}</h1>
      <div className="flex gap-1 rounded-lg border border-line bg-surface p-1 w-fit">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`rounded-md px-3.5 py-1.5 text-[13px] font-medium ${tab === key ? "bg-navy text-white" : "text-ink-2 hover:bg-canvas"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "business" && <BusinessTab />}
      {tab === "users" && <UsersTab />}
      {tab === "warehouses" && <WarehousesTab />}
      {tab === "methods" && <MethodsTab />}
      {tab === "receipt" && <ReceiptTab />}
    </div>
  );
}

function BusinessTab() {
  const { t } = useI18n();
  const { data: company, isLoading, mutate } = useApi<Company>("/companies/active");
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (company) {
      setForm(Object.fromEntries(
        ["name", "legal_name", "activity", "address", "city", "wilaya", "phone", "email", "nif", "nis", "rc", "ai", "invoice_footer"]
          .map((k) => [k, (company[k] as string) ?? ""])));
    }
  }, [company]);

  if (isLoading || !company) return <Spinner label={t("common.loading")} />;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setMsg(null);
    try {
      await apiFetch("/companies/active", { method: "PATCH", json: form });
      setMsg("✓"); mutate();
    } catch (err) {
      setMsg(err instanceof ClientApiError ? err.message : t("common.errorGeneric"));
    } finally { setSaving(false); }
  }

  const fields: Array<[string, string]> = [
    ["name", t("onboarding.businessName")], ["legal_name", t("customers.companyName")],
    ["activity", t("onboarding.activity")], ["phone", t("common.phone")],
    ["email", t("common.email")], ["address", t("common.address")],
    ["city", t("common.city")], ["wilaya", t("onboarding.wilaya")],
    ["nif", "NIF"], ["nis", "NIS"], ["rc", "RC"], ["ai", "AI"],
    ["invoice_footer", t("settings.invoiceFooter")],
  ];

  return (
    <Card title={t("settings.business")}>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        {fields.map(([key, label]) => (
          <Field key={key} label={label}>
            <Input value={form[key] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
          </Field>
        ))}
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" loading={saving}>{t("common.save")}</Button>
          {msg && <span className={msg === "✓" ? "text-ok" : "text-danger"}>{msg}</span>}
        </div>
      </form>
    </Card>
  );
}

function UsersTab() {
  const { t } = useI18n();
  const { data: members, mutate } = useApi<{ data: Member[] }>("/members");
  const { data: roles } = useApi<{ data: Role[]; catalog: PermDef[] }>("/roles");
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="space-y-4">
      <Card title={t("settings.usersRoles")} pad={false}
        actions={<Button className="h-8" onClick={() => setAddOpen(true)}><Plus size={14} /> {t("settings.addUser")}</Button>}>
        <table className="w-full text-sm">
          <tbody>
            {members?.data.map((m) => (
              <tr key={m.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  <p className="font-medium">{m.full_name}</p>
                  <p className="text-xs text-ink-3">{m.email}</p>
                </td>
                <td className="px-4 py-2.5">
                  {m.is_owner ? (
                    <Badge tone="info">{t("settings.owner")}</Badge>
                  ) : (
                    <MemberRoleSelect member={m} roles={roles?.data ?? []} onChanged={mutate} />
                  )}
                </td>
                <td className="px-4 py-2.5 text-end">
                  <Badge tone={m.status === "active" ? "ok" : "danger"}>
                    {m.status === "active" ? t("settings.active") : t("settings.suspended")}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title={t("settings.permissions")} pad={false}>
        <table className="w-full text-sm">
          <tbody>
            {roles?.data.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 font-medium">{r.name}</td>
                <td className="px-4 py-2.5 text-ink-3">
                  {r.permissions.length >= (roles?.catalog.length ?? 99) ? t("common.all") : `${r.permissions.length}`}
                </td>
                <td className="num px-4 py-2.5 text-end text-ink-3">{r.member_count} {t("settings.members")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {addOpen && (
        <AddUserModal roles={roles?.data ?? []} onClose={() => setAddOpen(false)}
          onDone={() => { setAddOpen(false); mutate(); }} />
      )}
    </div>
  );
}

function MemberRoleSelect({ member, roles, onChanged }: { member: Member; roles: Role[]; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  return (
    <Select
      value={member.role_id}
      disabled={saving}
      className="!h-8 max-w-[190px]"
      onChange={async (e) => {
        setSaving(true);
        try { await apiFetch(`/members/${member.id}`, { method: "PATCH", json: { roleId: e.target.value } }); onChanged(); }
        finally { setSaving(false); }
      }}
    >
      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
    </Select>
  );
}

function AddUserModal({ roles, onClose, onDone }: { roles: Role[]; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ fullName: "", email: "", password: "", roleId: roles.find((r) => r.name !== "Owner")?.id ?? "" });
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr(null);
    try {
      await apiFetch("/members", { method: "POST", json: form });
      onDone();
    } catch (e2) {
      setErr(e2 instanceof ClientApiError ? e2.message : t("common.errorGeneric"));
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("settings.addUser")}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("auth.fullName")} required>
          <Input value={form.fullName} onChange={(e) => set("fullName", e.target.value)} autoFocus required />
        </Field>
        <Field label={t("auth.email")} required>
          <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
        </Field>
        <Field label={t("auth.password")} required hint={t("auth.passwordHint")}>
          <Input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} required minLength={8} />
        </Field>
        <Field label={t("settings.role")} required>
          <Select value={form.roleId} onChange={(e) => set("roleId", e.target.value)}>
            {roles.filter((r) => r.name !== "Owner").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </Field>
        {err && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" loading={loading}>{t("common.create")}</Button>
        </div>
      </form>
    </Modal>
  );
}

function WarehousesTab() {
  const { t } = useI18n();
  const { data, mutate } = useApi<{ data: Warehouse[] }>("/warehouses");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <Card title={t("settings.warehouses")} pad={false}>
      <table className="w-full text-sm">
        <tbody>
          {data?.data.map((w) => (
            <tr key={w.id} className="border-b border-line">
              <td className="px-4 py-2.5 font-medium">{w.name}</td>
              <td className="px-4 py-2.5 text-end">
                {w.is_default && <Badge tone="info">★</Badge>}{" "}
                <Badge tone={w.is_active ? "ok" : "neutral"}>{w.is_active ? t("settings.active") : "—"}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="flex gap-2 p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setLoading(true);
          try { await apiFetch("/warehouses", { method: "POST", json: { name: name.trim() } }); setName(""); mutate(); }
          finally { setLoading(false); }
        }}
      >
        <Input placeholder={t("common.name")} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" loading={loading}><Plus size={14} /> {t("common.add")}</Button>
      </form>
    </Card>
  );
}

function MethodsTab() {
  const { t } = useI18n();
  const { data, mutate } = useApi<{ data: Method[] }>("/payment-methods");
  const [form, setForm] = useState({ name: "", code: "", kind: "other" });
  const [loading, setLoading] = useState(false);

  return (
    <Card title={t("settings.paymentMethods")} pad={false}>
      <table className="w-full text-sm">
        <tbody>
          {data?.data.map((m) => (
            <tr key={m.id} className="border-b border-line">
              <td className="px-4 py-2.5 font-medium">{m.name}</td>
              <td className="px-4 py-2.5 text-ink-3">{m.code}</td>
              <td className="px-4 py-2.5 text-end"><Badge tone="neutral">{m.kind}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="flex flex-wrap gap-2 p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!form.name.trim() || !form.code.trim()) return;
          setLoading(true);
          try {
            await apiFetch("/payment-methods", { method: "POST", json: form });
            setForm({ name: "", code: "", kind: "other" }); mutate();
          } finally { setLoading(false); }
        }}
      >
        <Input placeholder={t("common.name")} value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="max-w-[180px]" />
        <Input placeholder="code" value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} className="max-w-[120px]" />
        <Select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))} className="max-w-[130px]">
          {["cash", "card", "bank", "cheque", "credit", "other"].map((k) => <option key={k}>{k}</option>)}
        </Select>
        <Button type="submit" loading={loading}><Plus size={14} /> {t("common.add")}</Button>
      </form>
    </Card>
  );
}

type ReceiptSettings = {
  paperWidth: "58" | "80";
  headerText: string; footerText: string;
  showNif: boolean; showTaxDetail: boolean;
  showCashier: boolean; showCustomer: boolean;
  autoPrint: boolean;
};

function ReceiptTab() {
  const { t } = useI18n();
  const { data, isLoading, mutate } = useApi<{ value: ReceiptSettings }>("/settings/receipt");
  const [form, setForm] = useState<ReceiptSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { if (data && !form) setForm(data.value); }, [data, form]);
  if (isLoading || !form) return <Spinner label={t("common.loading")} />;

  const set = <K extends keyof ReceiptSettings>(k: K, v: ReceiptSettings[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setMsg(null);
    try {
      await apiFetch("/settings/receipt", { method: "PUT", json: form });
      setMsg("✓"); mutate();
    } catch (err) {
      setMsg(err instanceof ClientApiError ? err.message : t("common.errorGeneric"));
    } finally { setSaving(false); }
  }

  const toggles: Array<[keyof ReceiptSettings, string]> = [
    ["showNif", t("receipt.showNif")],
    ["showTaxDetail", t("receipt.showTaxDetail")],
    ["showCashier", t("receipt.showCashier")],
    ["showCustomer", t("receipt.showCustomer")],
    ["autoPrint", t("receipt.autoPrint")],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t("receipt.settings")}>
        <form onSubmit={save} className="space-y-4">
          <Field label={t("receipt.paperWidth")}>
            <Select value={form.paperWidth} onChange={(e) => set("paperWidth", e.target.value as "58" | "80")}>
              <option value="80">{t("receipt.mm80")}</option>
              <option value="58">{t("receipt.mm58")}</option>
            </Select>
          </Field>
          <Field label={t("receipt.headerText")}>
            <textarea rows={2} value={form.headerText} onChange={(e) => set("headerText", e.target.value)}
              className="w-full rounded-lg border border-line-2 bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15" />
          </Field>
          <Field label={t("receipt.footerText")}>
            <textarea rows={2} value={form.footerText} onChange={(e) => set("footerText", e.target.value)}
              className="w-full rounded-lg border border-line-2 bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15" />
          </Field>
          <div className="space-y-2">
            {toggles.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-[13.5px] text-ink-2">
                <input type="checkbox" checked={form[key] as boolean}
                  onChange={(e) => set(key, e.target.checked as never)} />
                {label}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" loading={saving}>{t("common.save")}</Button>
            {msg && <span className={msg === "✓" ? "text-ok" : "text-danger"}>{msg}</span>}
          </div>
        </form>
      </Card>

      <Card title={t("receipt.preview")}>
        <div className="flex justify-center">
          <div
            className="border border-line bg-white text-black shadow-card"
            style={{
              width: form.paperWidth === "58" ? "58mm" : "80mm",
              padding: form.paperWidth === "58" ? "3mm 2.5mm" : "4mm 3.5mm",
              fontFamily: "'Courier New', ui-monospace, monospace",
              fontSize: form.paperWidth === "58" ? "10.5px" : "12px",
              lineHeight: 1.35,
            }}
            dir="ltr"
          >
            <div className="text-center">
              <p className="text-[1.25em] font-bold uppercase">DAITEC DEMO STORE</p>
              <p>Rue Didouche Mourad, Alger</p>
              {form.showNif && <p>NIF: 099916001111111</p>}
              {form.headerText && <p className="mt-1 whitespace-pre-line">{form.headerText}</p>}
            </div>
            <p className="my-1 overflow-hidden whitespace-nowrap">{"-".repeat(64)}</p>
            <p>{t("receipt.ticketNo")} TCK2026-00042</p>
            {form.showCashier && <p>{t("receipt.cashier")}: Yacine</p>}
            {form.showCustomer && <p>{t("sales.customer")}: {t("sales.walkIn")}</p>}
            <p className="my-1 overflow-hidden whitespace-nowrap">{"-".repeat(64)}</p>
            <p className="font-bold">Samsung Galaxy A15</p>
            <div className="flex justify-between"><span>2 x 33500.00</span><span>79730.00</span></div>
            <p className="my-1 overflow-hidden whitespace-nowrap">{"-".repeat(64)}</p>
            <div className="flex justify-between"><span>{t("common.subtotal")}</span><span>67000.00</span></div>
            {form.showTaxDetail && <div className="flex justify-between"><span>{t("common.tax")}</span><span>12730.00</span></div>}
            <div className="flex justify-between text-[1.3em] font-bold"><span>{t("common.total")}</span><span>79 730 DA</span></div>
            <p className="my-1 overflow-hidden whitespace-nowrap">{"-".repeat(64)}</p>
            <div className="text-center">
              {form.footerText && <p className="whitespace-pre-line">{form.footerText}</p>}
              <p className="mt-1">* * *</p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

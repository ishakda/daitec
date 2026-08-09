"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ClientApiError } from "@/lib/client";
import { useI18n } from "@/components/I18nProvider";
import { Button, Input, Field } from "@/components/ui";
import { AuthShell } from "../shell";

const WILAYAS = ["Adrar","Chlef","Laghouat","Oum El Bouaghi","Batna","Béjaïa","Biskra","Béchar","Blida","Bouira","Tamanrasset","Tébessa","Tlemcen","Tiaret","Tizi Ouzou","Alger","Djelfa","Jijel","Sétif","Saïda","Skikda","Sidi Bel Abbès","Annaba","Guelma","Constantine","Médéa","Mostaganem","M'Sila","Mascara","Ouargla","Oran","El Bayadh","Illizi","Bordj Bou Arreridj","Boumerdès","El Tarf","Tindouf","Tissemsilt","El Oued","Khenchela","Souk Ahras","Tipaza","Mila","Aïn Defla","Naâma","Aïn Témouchent","Ghardaïa","Relizane"];

export default function OnboardingPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState({ name: "", activity: "", city: "", wilaya: "Alger", nif: "", nis: "", rc: "", ai: "", defaultTaxRate: 19 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: string, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      await apiFetch("/companies", {
        method: "POST",
        json: {
          name: form.name, activity: form.activity || undefined, city: form.city || undefined,
          wilaya: form.wilaya, nif: form.nif || undefined, nis: form.nis || undefined,
          rc: form.rc || undefined, ai: form.ai || undefined,
          defaultTaxRate: Number(form.defaultTaxRate),
        },
      });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : t("common.errorGeneric"));
      setLoading(false);
    }
  }

  return (
    <AuthShell title={t("onboarding.title")}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("onboarding.businessName")} required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus required minLength={2} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("onboarding.activity")}>
            <Input value={form.activity} onChange={(e) => set("activity", e.target.value)} />
          </Field>
          <Field label={t("onboarding.taxRate")}>
            <Input type="number" min={0} max={100} step="0.01" value={form.defaultTaxRate}
              onChange={(e) => set("defaultTaxRate", e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("common.city")}>
            <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label={t("onboarding.wilaya")}>
            <select value={form.wilaya} onChange={(e) => set("wilaya", e.target.value)}
              className="h-9 w-full rounded-lg border border-line-2 bg-surface px-2.5 text-sm outline-none focus:border-accent">
              {WILAYAS.map((w) => <option key={w}>{w}</option>)}
            </select>
          </Field>
        </div>
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-[13px] font-medium text-ink-2">{t("onboarding.identifiers")}</summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="NIF"><Input value={form.nif} onChange={(e) => set("nif", e.target.value)} /></Field>
            <Field label="NIS"><Input value={form.nis} onChange={(e) => set("nis", e.target.value)} /></Field>
            <Field label="RC"><Input value={form.rc} onChange={(e) => set("rc", e.target.value)} /></Field>
            <Field label="AI"><Input value={form.ai} onChange={(e) => set("ai", e.target.value)} /></Field>
          </div>
        </details>
        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Button type="submit" loading={loading} className="w-full">
          {loading ? t("onboarding.creating") : t("onboarding.start")}
        </Button>
      </form>
    </AuthShell>
  );
}

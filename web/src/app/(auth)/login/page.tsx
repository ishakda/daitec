"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ClientApiError } from "@/lib/client";
import { useI18n } from "@/components/I18nProvider";
import { Button, Input, Field } from "@/components/ui";
import { AuthShell } from "../shell";

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const r = await apiFetch<{ companies: string[] }>("/auth/login", {
        method: "POST", json: { email, password },
      });
      router.push(r.companies.length === 0 ? "/onboarding" : "/dashboard");
    } catch (err) {
      setError(err instanceof ClientApiError && err.code === "INVALID_CREDENTIALS"
        ? t("auth.invalidCredentials") : t("common.errorGeneric"));
      setLoading(false);
    }
  }

  return (
    <AuthShell title={t("auth.loginTitle")}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("auth.email")} required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        </Field>
        <Field label={t("auth.password")} required>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Button type="submit" loading={loading} className="w-full">{t("auth.login")}</Button>
        <p className="text-center text-[13px] text-ink-3">
          {t("auth.noAccount")}{" "}
          <Link href="/signup" className="font-medium text-accent hover:underline">{t("auth.signup")}</Link>
        </p>
      </form>
    </AuthShell>
  );
}

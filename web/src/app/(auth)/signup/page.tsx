"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ClientApiError } from "@/lib/client";
import { useI18n } from "@/components/I18nProvider";
import { Button, Input, Field } from "@/components/ui";
import { AuthShell } from "../shell";

export default function SignupPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      await apiFetch("/auth/signup", { method: "POST", json: { email, password, fullName, locale } });
      router.push("/onboarding");
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : t("common.errorGeneric"));
      setLoading(false);
    }
  }

  return (
    <AuthShell title={t("auth.signupTitle")}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("auth.fullName")} required>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus required minLength={2} />
        </Field>
        <Field label={t("auth.email")} required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label={t("auth.password")} required hint={t("auth.passwordHint")}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </Field>
        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Button type="submit" loading={loading} className="w-full">{t("auth.signup")}</Button>
        <p className="text-center text-[13px] text-ink-3">
          {t("auth.hasAccount")}{" "}
          <Link href="/login" className="font-medium text-accent hover:underline">{t("auth.login")}</Link>
        </p>
      </form>
    </AuthShell>
  );
}

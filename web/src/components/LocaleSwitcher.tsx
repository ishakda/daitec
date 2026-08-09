"use client";
import { useI18n } from "./I18nProvider";
import { apiFetch } from "@/lib/client";

const LABELS: Record<string, string> = { fr: "Français", ar: "العربية", en: "English" };

export function LocaleSwitcher({ compact }: { compact?: boolean }) {
  const { locale } = useI18n();
  async function change(l: string) {
    await apiFetch("/me/locale", { method: "POST", json: { locale: l } });
    window.location.reload();
  }
  return (
    <select
      value={locale}
      onChange={(e) => change(e.target.value)}
      className={`rounded-lg border border-line-2 bg-surface text-[13px] text-ink-2 outline-none
        focus:border-accent ${compact ? "h-8 px-1.5" : "h-9 px-2"}`}
    >
      {Object.entries(LABELS).map(([code, label]) => (
        <option key={code} value={code}>{label}</option>
      ))}
    </select>
  );
}

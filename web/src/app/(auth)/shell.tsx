"use client";
import { ReactNode } from "react";
import { useI18n } from "@/components/I18nProvider";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold tracking-tight text-navy">Daitec</span>
          <span className="hidden text-[13px] text-ink-3 sm:block">{t("app.tagline")}</span>
        </div>
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-[8vh]">
        <div className="w-full max-w-md">
          <h1 className="mb-5 text-center text-xl font-semibold text-ink">{title}</h1>
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">{children}</div>
        </div>
      </main>
    </div>
  );
}

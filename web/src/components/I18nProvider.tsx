"use client";
import { createContext, useContext, useCallback, ReactNode } from "react";

type Messages = Record<string, unknown>;
type I18nCtx = {
  locale: string;
  dir: "ltr" | "rtl";
  t: (key: string, params?: Record<string, string | number>) => string;
  formatMoney: (n: number | string, currency?: string) => string;
  formatDate: (d: string | Date) => string;
  formatDateTime: (d: string | Date) => string;
};

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({
  locale, messages, children,
}: { locale: string; messages: Messages; children: ReactNode }) {
  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const parts = key.split(".");
      let cur: unknown = messages;
      for (const p of parts) {
        if (cur && typeof cur === "object" && p in (cur as Messages)) {
          cur = (cur as Messages)[p];
        } else return key;
      }
      let s = typeof cur === "string" ? cur : key;
      if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
    [messages]
  );

  const intlLocale = locale === "ar" ? "ar-DZ" : locale === "en" ? "en-GB" : "fr-DZ";
  const formatMoney = useCallback(
    (n: number | string, currency = "DZD") => {
      const num = typeof n === "string" ? parseFloat(n) : n;
      return new Intl.NumberFormat(intlLocale, {
        style: "currency", currency, maximumFractionDigits: 2, minimumFractionDigits: 0,
      }).format(isNaN(num) ? 0 : num);
    },
    [intlLocale]
  );
  const formatDate = useCallback(
    (d: string | Date) => new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium" }).format(new Date(d)),
    [intlLocale]
  );
  const formatDateTime = useCallback(
    (d: string | Date) =>
      new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(d)),
    [intlLocale]
  );

  return (
    <Ctx.Provider value={{ locale, dir: locale === "ar" ? "rtl" : "ltr", t, formatMoney, formatDate, formatDateTime }}>
      {children}
    </Ctx.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}

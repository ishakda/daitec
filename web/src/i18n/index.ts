import { cookies } from "next/headers";
import fr from "./fr.json";
import ar from "./ar.json";
import en from "./en.json";

export type Locale = "fr" | "ar" | "en";
export const LOCALES: Locale[] = ["fr", "ar", "en"];
export const LOCALE_COOKIE = "sahla_locale";

const CATALOGS: Record<Locale, Record<string, unknown>> = { fr, ar, en };

export async function getLocale(): Promise<Locale> {
  const jar = await cookies();
  const v = jar.get(LOCALE_COOKIE)?.value as Locale | undefined;
  return v && LOCALES.includes(v) ? v : "fr";
}

export function getMessages(locale: Locale) {
  return CATALOGS[locale];
}

export const dirOf = (locale: Locale) => (locale === "ar" ? "rtl" : "ltr");

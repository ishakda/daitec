import type { Metadata } from "next";
import { Inter, Noto_Sans_Arabic } from "next/font/google";
import { getLocale, getMessages, dirOf } from "@/i18n";
import { I18nProvider } from "@/components/I18nProvider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const arabic = Noto_Sans_Arabic({ subsets: ["arabic"], variable: "--font-arabic" });

export const metadata: Metadata = {
  title: "Daitec — Gestion commerciale",
  description: "Plateforme moderne de gestion commerciale pour les entreprises algériennes",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body className={`${inter.variable} ${arabic.variable}`}>
        <I18nProvider locale={locale} messages={getMessages(locale)}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}

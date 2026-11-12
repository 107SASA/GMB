import { Noto_Sans_Devanagari } from "next/font/google";

/**
 * Hindi pages (/hi/...). Inter / Space Grotesk have no Devanagari letters, so
 * this loads Noto Sans Devanagari only on Hindi routes; globals.css puts it in
 * the font stack for `.theme-marketing[lang="hi"]`.
 */
const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-noto-devanagari",
  display: "swap",
});

export default function HindiLayout({ children }: { children: React.ReactNode }) {
  return <div className={devanagari.variable}>{children}</div>;
}

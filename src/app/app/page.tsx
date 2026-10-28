import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { appStoreUrl, playStoreUrl } from "@/lib/appStoreLinks";

export const metadata: Metadata = {
  title: "Get the App",
  description:
    "Download the GrowwMatics AI mobile app to manage your Google Business Profile, reviews, content, and leads from your phone.",
  alternates: { canonical: "/app" },
};

const PLAY_STORE_URL = playStoreUrl();
// Set NEXT_PUBLIC_APP_STORE_URL once the iOS app is live on the App Store.
const APP_STORE_URL = appStoreUrl();

const ANDROID_STEPS = [
  "Tap “Get it on Google Play” to open the Play Store.",
  "Tap Install, then Open.",
  "Sign in with your registered phone number — we’ll send a one-time code on WhatsApp.",
] as const;

export default function GetTheAppPage() {
  return (
    <main className="theme-marketing min-h-screen bg-white selection:bg-primary-fixed">
      <Navbar />

      <section className="relative pt-28 sm:pt-32 md:pt-40 pb-14 sm:pb-20 px-4 sm:px-6 md:px-12">
        <div className="max-w-[1280px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-6 items-start">
            <div className="lg:col-span-7">
              <p className="mkt-label inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-(--mkt-line) bg-white text-[#006e2c] mb-6">
                GrowwMatics AI — Mobile App
              </p>
              <h1 className="font-mkt-display text-[2rem] sm:text-5xl md:text-6xl font-semibold text-[#101613] leading-[1.08] tracking-tight mb-6">
                Run your growth from{" "}
                <span className="text-[#006e2c]">your pocket.</span>
              </h1>
              <p className="text-base sm:text-lg text-[#3d4a3d] max-w-xl leading-relaxed mb-8">
                Track your Google Maps ranking, reply to reviews, publish posts,
                and follow up with leads — all from the app. Your account is the
                same one you use on the web portal.
              </p>

              <div className="flex flex-wrap gap-3">
                <a
                  href={PLAY_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-7 py-3.5 rounded-lg bg-[#006e2c] text-white font-semibold hover:bg-[#005a24] transition-colors"
                >
                  <span aria-hidden>▶</span> Get it on Google Play
                </a>
                {APP_STORE_URL && (
                  <a
                    href={APP_STORE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-7 py-3.5 rounded-lg border border-[#006e2c] text-[#006e2c] font-semibold hover:bg-[#006e2c]/5 transition-colors"
                  >
                    Download on the App Store
                  </a>
                )}
              </div>
              <p className="text-sm text-[#6b756f] mt-3">
                Android 8.0 or newer. Your account is the same as on the web portal.
              </p>
            </div>

            <div className="lg:col-span-5 lg:mt-4">
              <div className="rounded-2xl border border-(--mkt-line) shadow-card p-6 sm:p-8 bg-white">
                <h2 className="font-mkt-display text-xl font-semibold text-[#101613] mb-5">
                  Installing on Android
                </h2>
                <ol className="flex flex-col gap-4">
                  {ANDROID_STEPS.map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="font-mkt-mono text-xs text-white bg-[#006e2c] rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-sm text-[#3d4a3d] leading-relaxed">
                        {step}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-14 sm:py-16 px-4 sm:px-6 md:px-12 bg-(--mkt-surface)">
        <div className="max-w-[1280px] mx-auto grid grid-cols-1 sm:grid-cols-2 gap-8">
          <div>
            <h2 className="font-mkt-display text-xl sm:text-2xl font-semibold text-[#101613] mb-2">
              iPhone / iOS
            </h2>
            <p className="text-[#3d4a3d] leading-relaxed">
              {APP_STORE_URL ? (
                <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" className="text-[#006e2c] font-semibold hover:underline">
                  Download the iPhone app on the App Store
                </a>
              ) : (
                "The iOS app is on its way. In the meantime, you can use the full web portal from any mobile browser."
              )}
            </p>
          </div>
          <div>
            <h2 className="font-mkt-display text-xl sm:text-2xl font-semibold text-[#101613] mb-2">
              Prefer the web?
            </h2>
            <p className="text-[#3d4a3d] leading-relaxed">
              Everything the app does is also available on the web portal.{" "}
              <Link href="/login" className="text-[#006e2c] font-semibold hover:underline">
                Log in to the web portal →
              </Link>
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}

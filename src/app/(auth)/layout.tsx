import { BRAND_ATTRIBUTION } from "@/lib/companyInfo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-primary/8 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-secondary/8 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <img src="/brand/icon.png" alt="GrowwMatics AI" className="inline-block w-12 h-12 object-contain mb-4" />
          <h1 className="text-headline-md font-heading text-on-surface tracking-tight">
            Groww<span className="text-primary">Matics</span> AI
          </h1>
        </div>

        {children}

        <p className="text-center text-xs text-outline mt-8 relative z-10">{BRAND_ATTRIBUTION}</p>
      </div>
    </div>
  );
}

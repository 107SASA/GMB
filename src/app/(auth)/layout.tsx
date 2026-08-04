import { MaterialIcon } from "@/components/ui/MaterialIcon";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-primary/8 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-secondary/8 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary mb-4">
            <MaterialIcon name="rocket_launch" size={24} className="text-on-primary" />
          </div>
          <h1 className="text-headline-md font-heading text-on-surface tracking-tight">
            Groww<span className="text-primary">Matics</span> AI
          </h1>
        </div>

        {children}
      </div>
    </div>
  );
}

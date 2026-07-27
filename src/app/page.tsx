import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Hero } from "@/components/sections/Hero";
import { Features } from "@/components/sections/Features";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { ProductShowcase } from "@/components/sections/ProductShowcase";
import { Pricing } from "@/components/sections/Pricing";
import { FAQ } from "@/components/sections/FAQ";
import { FinalCTA } from "@/components/sections/SocialProof";

export default function Home() {
  return (
    <main className="min-h-screen bg-background selection:bg-primary/30">
      <Navbar />

      <Hero />

      <Features />

      <HowItWorks />

      <ProductShowcase />

      <Pricing />

      <FAQ />

      <FinalCTA />

      <Footer />
    </main>
  );
}

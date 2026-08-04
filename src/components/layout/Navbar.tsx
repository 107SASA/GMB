"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

const navLinks = [
  { name: "Features", href: "#features" },
  { name: "Pricing", href: "#pricing" },
  { name: "FAQ", href: "#faq" },
];

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 h-16 transition-all duration-300 px-6 flex items-center",
        isScrolled
          ? "bg-surface-container-lowest/95 backdrop-blur-md border-b border-outline-variant"
          : "bg-surface-container-lowest/80 border-b border-transparent"
      )}
    >
      <nav className="max-w-container-max mx-auto w-full flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
            <MaterialIcon name="rocket_launch" size={22} className="text-on-primary" />
          </div>
          <span className="text-xl font-heading font-bold tracking-tight text-on-surface">
            GrowwMatics AI
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <Link
              key={link.name}
              href={link.href}
              className="text-sm font-medium text-on-surface-variant hover:text-primary transition-colors"
            >
              {link.name}
            </Link>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-4">
          <Link
            href="/login"
            className="text-sm font-medium text-on-surface-variant hover:text-on-surface transition-colors"
          >
            Login
          </Link>
          <Link
            href="/free-report"
            className="px-5 py-2.5 bg-primary text-on-primary rounded-lg text-sm font-semibold hover:bg-primary-container transition-all active:scale-95"
          >
            Get Free Report
          </Link>
        </div>

        <button
          className="md:hidden text-on-surface p-2 rounded-lg hover:bg-surface-container"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
        >
          <MaterialIcon name={mobileMenuOpen ? "close" : "menu"} size={24} />
        </button>
      </nav>

      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-full left-0 right-0 bg-surface-container-lowest border-b border-outline-variant p-6 flex flex-col gap-6 md:hidden card-shadow"
          >
            {navLinks.map((link) => (
              <Link
                key={link.name}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="text-lg font-medium text-on-surface-variant hover:text-on-surface"
              >
                {link.name}
              </Link>
            ))}
            <div className="flex flex-col gap-4 pt-4 border-t border-outline-variant">
              <Link
                href="/login"
                onClick={() => setMobileMenuOpen(false)}
                className="text-lg font-medium text-on-surface-variant hover:text-on-surface text-left"
              >
                Login
              </Link>
              <Link
                href="/free-report"
                onClick={() => setMobileMenuOpen(false)}
                className="px-6 py-3 bg-primary text-on-primary rounded-lg text-center font-bold"
              >
                Get Free Report
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

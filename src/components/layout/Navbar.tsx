"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { SERVICES } from "@/lib/servicesData";
import { BookDemoButton } from "@/components/shared/BookDemoButton";

// Pricing and FAQ stay live pages (linked from the footer, still indexable)
// — just decluttered off the header per the Aug 2026 nav redesign.
const navLinks = [
  { name: "Features", href: "/features" },
  { name: "About Us", href: "/about" },
];

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileServicesOpen, setMobileServicesOpen] = useState(false);
  const [servicesMenuOpen, setServicesMenuOpen] = useState(false);
  // Delays closing the desktop dropdown slightly so moving the mouse from
  // the "OnDemand Service" trigger down into the panel doesn't close it
  // mid-transit — a bare onMouseLeave on either element alone is too eager.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openServicesMenu = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setServicesMenuOpen(true);
  };
  const scheduleCloseServicesMenu = () => {
    closeTimer.current = setTimeout(() => setServicesMenuOpen(false), 150);
  };

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
          <img src="/brand/icon.png" alt="GrowwMatics AI" className="w-10 h-10 object-contain" />
          <span className="text-xl font-heading font-bold tracking-tight text-on-surface">
            GrowwMatics AI
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          {/* OnDemand Service — mega-menu, placed before Features per the site's nav order */}
          <div
            className="relative"
            onMouseEnter={openServicesMenu}
            onMouseLeave={scheduleCloseServicesMenu}
          >
            <button
              type="button"
              onClick={() => setServicesMenuOpen((v) => !v)}
              aria-expanded={servicesMenuOpen}
              className="flex items-center gap-1 text-sm font-medium text-on-surface-variant hover:text-primary transition-colors"
            >
              OnDemand Service
              <MaterialIcon
                name="expand_more"
                size={18}
                className={cn("transition-transform text-outline", servicesMenuOpen && "rotate-180")}
              />
            </button>

            <AnimatePresence>
              {servicesMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full left-1/2 -translate-x-1/2 pt-3 w-160"
                >
                  <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl card-shadow p-5 grid grid-cols-2 gap-2">
                    {SERVICES.map((service) => (
                      <Link
                        key={service.slug}
                        href={`/services/${service.slug}`}
                        onClick={() => setServicesMenuOpen(false)}
                        className="flex items-start gap-3.5 p-3.5 rounded-xl hover:bg-surface-container-low transition-colors group"
                      >
                        <div className="w-11 h-11 rounded-xl bg-linear-to-br from-primary-fixed to-primary-fixed-dim/60 border border-primary-fixed-dim text-primary flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                          <MaterialIcon name={service.icon} size={20} />
                        </div>
                        <div>
                          <div className="text-sm font-bold text-on-surface group-hover:text-primary transition-colors">
                            {service.name}
                          </div>
                          <div className="text-xs text-on-surface-variant mt-1 leading-relaxed">{service.tagline}</div>
                        </div>
                      </Link>
                    ))}
                    <Link
                      href="/services"
                      onClick={() => setServicesMenuOpen(false)}
                      className="col-span-2 flex items-center justify-center gap-1.5 mt-1 p-3 rounded-xl text-sm font-semibold text-primary hover:bg-primary-fixed transition-colors border-t border-outline-variant"
                    >
                      View all services
                      <MaterialIcon name="arrow_forward" size={16} className="text-primary" />
                    </Link>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

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
          <BookDemoButton
            origin="navbar"
            className="px-5 py-2.5 bg-primary text-on-primary rounded-lg text-sm font-semibold hover:bg-primary-container transition-all active:scale-95"
          >
            Book Free Demo
          </BookDemoButton>
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
            className="absolute top-full left-0 right-0 bg-surface-container-lowest border-b border-outline-variant p-6 flex flex-col gap-6 md:hidden card-shadow max-h-[calc(100vh-4rem)] overflow-y-auto"
          >
            {/* OnDemand Service — expandable on mobile instead of a hover menu */}
            <div>
              <button
                type="button"
                onClick={() => setMobileServicesOpen((v) => !v)}
                aria-expanded={mobileServicesOpen}
                className="w-full flex items-center justify-between text-lg font-medium text-on-surface-variant hover:text-on-surface"
              >
                OnDemand Service
                <MaterialIcon
                  name="expand_more"
                  size={22}
                  className={cn("transition-transform", mobileServicesOpen && "rotate-180")}
                />
              </button>
              <AnimatePresence>
                {mobileServicesOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-4 pl-4 flex flex-col gap-4">
                      {SERVICES.map((service) => (
                        <Link
                          key={service.slug}
                          href={`/services/${service.slug}`}
                          onClick={() => setMobileMenuOpen(false)}
                          className="text-base font-medium text-on-surface-variant hover:text-primary"
                        >
                          {service.name}
                        </Link>
                      ))}
                      <Link
                        href="/services"
                        onClick={() => setMobileMenuOpen(false)}
                        className="text-base font-bold text-primary"
                      >
                        View all services →
                      </Link>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

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
              <BookDemoButton
                origin="navbar-mobile"
                onTriggerClick={() => setMobileMenuOpen(false)}
                className="px-6 py-3 bg-primary text-on-primary rounded-lg text-center font-bold"
              >
                Book Free Demo
              </BookDemoButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

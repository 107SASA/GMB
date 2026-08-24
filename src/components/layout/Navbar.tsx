"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { BookDemoButton } from "@/components/shared/BookDemoButton";
import { SERVICES } from "@/lib/servicesData";

const navLinks = [
  { name: "How it Works", href: "/#features" },
  { name: "About Us", href: "/about" },
  { name: "Free GBP Report", href: "/free-report" },
];

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileServicesOpen, setMobileServicesOpen] = useState(false);
  const [servicesMenuOpen, setServicesMenuOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "Login" always pointed a returning, already-authenticated visitor back
  // through the WhatsApp OTP flow (real per-message cost) instead of
  // straight to their dashboard. Defaults to false (shows "Login") until
  // this resolves — a brief flash is fine here since most marketing-page
  // visitors aren't logged in anyway, and getting it wrong the other way
  // (briefly claiming "Dashboard" for a logged-out visitor) would be worse.
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then((res) => { if (!cancelled) setIsLoggedIn(res.ok); })
      .catch(() => { /* stay logged-out-looking on error */ });
    return () => { cancelled = true; };
  }, []);

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
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  // Lock body scroll while mobile drawer is open
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileMenuOpen]);

  // Close drawer on resize to desktop
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024) setMobileMenuOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 h-16 md:h-[72px] transition-all duration-300 px-4 sm:px-6 flex items-center",
        isScrolled || mobileMenuOpen
          ? "bg-white/95 backdrop-blur-md border-b border-(--mkt-line) shadow-sm"
          : "bg-white border-b border-transparent"
      )}
    >
      <nav className="max-w-[1280px] mx-auto w-full flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2.5 shrink-0 min-w-0">
          <img src="/brand/icon.png" alt="GrowwMatics AI" className="w-8 h-8 md:w-9 md:h-9 object-contain shrink-0" />
          <span className="font-mkt-display text-base sm:text-lg md:text-xl font-semibold tracking-tight text-[#101613] truncate">
            Growwmatics
          </span>
        </Link>

        <div className="hidden lg:flex items-center gap-6 xl:gap-7 absolute left-1/2 -translate-x-1/2">
          <div
            className="relative"
            onMouseEnter={openServicesMenu}
            onMouseLeave={scheduleCloseServicesMenu}
          >
            <button
              type="button"
              onClick={() => setServicesMenuOpen((v) => !v)}
              aria-expanded={servicesMenuOpen}
              className="font-mkt-display flex items-center gap-1 text-sm font-medium text-[#3d4a3d] hover:text-[#006e2c] transition-colors whitespace-nowrap min-h-[44px]"
            >
              OnDemand Services
              <MaterialIcon
                name="expand_more"
                size={18}
                className={cn("transition-transform text-[#9aa59c]", servicesMenuOpen && "rotate-180")}
              />
            </button>

            <AnimatePresence>
              {servicesMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full left-1/2 -translate-x-1/2 pt-3 w-[min(40rem,calc(100vw-2rem))]"
                >
                  <div className="bg-white border border-(--mkt-line) rounded-xl shadow-lg p-4 md:p-5 grid grid-cols-2 gap-2">
                    {SERVICES.map((service) => (
                      <Link
                        key={service.slug}
                        href={`/services/${service.slug}`}
                        onClick={() => setServicesMenuOpen(false)}
                        className="flex items-start gap-3 p-3 rounded-lg hover:bg-(--mkt-surface) transition-colors group"
                      >
                        <div className="w-10 h-10 rounded-lg bg-[#e8f8ee] border border-[#c8ebd4] text-[#006e2c] flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                          <MaterialIcon name={service.icon} size={20} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-[#101613] group-hover:text-[#006e2c] transition-colors">
                            {service.name}
                          </div>
                          <div className="text-xs text-[#3d4a3d] mt-1 leading-relaxed">
                            {service.tagline}
                          </div>
                        </div>
                      </Link>
                    ))}
                    <Link
                      href="/services"
                      onClick={() => setServicesMenuOpen(false)}
                      className="col-span-2 flex items-center justify-center gap-1.5 mt-1 p-3 rounded-lg text-sm font-semibold text-[#006e2c] hover:bg-[#e8f8ee] transition-colors border-t border-(--mkt-line)"
                    >
                      View all services
                      <MaterialIcon name="arrow_forward" size={16} className="text-[#006e2c]" />
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
              className="font-mkt-display text-sm font-medium text-[#3d4a3d] hover:text-[#006e2c] transition-colors whitespace-nowrap min-h-[44px] inline-flex items-center"
            >
              {link.name}
            </Link>
          ))}
        </div>

        <div className="hidden lg:flex items-center gap-4 shrink-0">
          <Link
            href={isLoggedIn ? '/dashboard' : '/login'}
            className="font-mkt-display text-sm font-medium text-[#3d4a3d] hover:text-[#006e2c] transition-colors min-h-[44px] inline-flex items-center"
          >
            {isLoggedIn ? 'Dashboard' : 'Login'}
          </Link>
          <BookDemoButton
            origin="navbar"
            iconSize={16}
            className="px-5 py-2.5 bg-[#006e2c] text-white rounded-md text-sm font-semibold hover:bg-[#005a24] transition-all active:scale-[0.98] shadow-sm min-h-[44px]"
          />
        </div>

        <button
          type="button"
          className="lg:hidden text-[#101613] p-2.5 -mr-1 rounded-lg hover:bg-(--mkt-surface) min-h-[44px] min-w-[44px] flex items-center justify-center"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileMenuOpen}
        >
          <MaterialIcon name={mobileMenuOpen ? "close" : "menu"} size={24} />
        </button>
      </nav>

      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute top-full left-0 right-0 bg-white border-b border-(--mkt-line) px-4 py-5 sm:px-6 flex flex-col gap-1 lg:hidden shadow-lg max-h-[min(100dvh-4rem,100vh-4rem)] overflow-y-auto overscroll-contain"
          >
            <div className="pb-2">
              <button
                type="button"
                onClick={() => setMobileServicesOpen((v) => !v)}
                aria-expanded={mobileServicesOpen}
                className="w-full flex items-center justify-between text-base font-medium text-[#3d4a3d] hover:text-[#006e2c] min-h-[48px]"
              >
                OnDemand Services
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
                    <div className="pb-2 pl-1 flex flex-col">
                      {SERVICES.map((service) => (
                        <Link
                          key={service.slug}
                          href={`/services/${service.slug}`}
                          onClick={() => setMobileMenuOpen(false)}
                          className="flex items-center gap-3 text-sm font-medium text-[#3d4a3d] hover:text-[#006e2c] min-h-[48px]"
                        >
                          <span className="w-9 h-9 rounded-lg bg-[#e8f8ee] text-[#006e2c] flex items-center justify-center shrink-0">
                            <MaterialIcon name={service.icon} size={16} />
                          </span>
                          {service.name}
                        </Link>
                      ))}
                      <Link
                        href="/services"
                        onClick={() => setMobileMenuOpen(false)}
                        className="text-sm font-bold text-[#006e2c] py-3"
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
                className="text-base font-medium text-[#3d4a3d] hover:text-[#006e2c] min-h-[48px] flex items-center"
              >
                {link.name}
              </Link>
            ))}
            <div className="flex flex-col gap-3 pt-4 mt-2 border-t border-(--mkt-line)">
              <Link
                href={isLoggedIn ? '/dashboard' : '/login'}
                onClick={() => setMobileMenuOpen(false)}
                className="text-base font-medium text-[#3d4a3d] hover:text-[#006e2c] min-h-[48px] flex items-center"
              >
                {isLoggedIn ? 'Dashboard' : 'Login'}
              </Link>
              <BookDemoButton
                origin="navbar-mobile"
                onTriggerClick={() => setMobileMenuOpen(false)}
                className="w-full px-6 py-3.5 bg-[#006e2c] text-white rounded-md font-bold min-h-[48px]"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

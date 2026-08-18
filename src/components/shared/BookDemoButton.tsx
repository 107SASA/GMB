"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { bookDemoLink, bookDemoOpensWhatsApp } from "@/lib/whatsappCta";

interface BookDemoButtonProps {
  /** Which page/CTA triggered this — recorded on the Lead's notes so the
   *  CRM shows where each demo request came from (e.g. "navbar", "hero",
   *  "service:seo"). */
  origin: string;
  className?: string;
  children: React.ReactNode;
  /** Fires alongside opening the modal — e.g. closing a mobile nav drawer
   *  the trigger button lives inside. */
  onTriggerClick?: () => void;
}

/**
 * Shared trigger for the "Book a Demo" / "Book a Free Consultant" flow used
 * everywhere on the marketing site (Navbar, Hero, every service page).
 * Renders as a plain button carrying whatever className the call site
 * already used for its old <a href={bookDemoLink()}> — same look, new
 * behavior: a two-field form (name + WhatsApp) files a CRM Lead via
 * POST /api/leads/book-demo, then redirects to the existing WhatsApp
 * booking agent (bookDemoLink()) instead of skipping straight to WhatsApp
 * with no record of the visitor.
 */
export function BookDemoButton({ origin, className, children, onTriggerClick }: BookDemoButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          setOpen(true);
          onTriggerClick?.();
        }}
      >
        {children}
      </button>
      {open && <BookDemoModal origin={origin} onClose={() => setOpen(false)} />}
    </>
  );
}

function BookDemoModal({ origin, onClose }: { origin: string; onClose: () => void }) {
  const [step, setStep] = useState<"form" | "thanks">("form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const goToWhatsApp = () => {
    const link = bookDemoLink();
    if (bookDemoOpensWhatsApp) {
      window.open(link, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = link;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (!phone.trim()) {
      setError("Please enter your WhatsApp number.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/leads/book-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, origin }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      setStep("thanks");
      setSubmitting(false);
      // Give the visitor a moment to read the confirmation before handing
      // off to WhatsApp — not an instant redirect, per the "thank you
      // message" step the flow is supposed to have.
      setTimeout(goToWhatsApp, 1800);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-on-surface/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.97 }}
          transition={{ duration: 0.2 }}
          className="theme-marketing bg-surface-container-lowest rounded-2xl card-shadow w-full max-w-sm overflow-hidden relative"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface transition-colors z-10"
          >
            <MaterialIcon name="close" size={22} />
          </button>

          {step === "form" ? (
            <form onSubmit={handleSubmit} className="p-8">
              <div className="w-12 h-12 rounded-xl bg-primary-fixed border border-primary-fixed-dim flex items-center justify-center mb-5">
                <MaterialIcon name="calendar_month" size={22} className="text-primary" />
              </div>
              <h2 className="font-heading text-xl font-bold text-on-surface mb-1">Book a Free Demo</h2>
              <p className="text-on-surface-variant text-sm mb-6">
                Tell us who you are and we'll continue on WhatsApp.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-label-md text-on-surface mb-1.5">Your Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Priya Sharma"
                    autoFocus
                    className="w-full px-4 py-3 bg-surface border border-outline-variant rounded-lg text-on-surface placeholder:text-outline focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-label-md text-on-surface mb-1.5">WhatsApp Number</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full px-4 py-3 bg-surface border border-outline-variant rounded-lg text-on-surface placeholder:text-outline focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  />
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="mt-4 p-3 bg-error-container text-on-error-container rounded-lg text-sm font-medium flex items-start gap-2"
                >
                  <MaterialIcon name="error" size={18} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="mt-6 w-full py-3.5 bg-primary text-on-primary rounded-lg font-bold hover:bg-primary-container transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <MaterialIcon name="progress_activity" size={20} className="animate-spin" />
                ) : (
                  <>
                    Continue on WhatsApp
                    <MaterialIcon name="arrow_forward" size={18} />
                  </>
                )}
              </button>
            </form>
          ) : (
            <div className="p-8 text-center">
              <motion.div
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className="w-16 h-16 rounded-full bg-secondary-container flex items-center justify-center mx-auto mb-5"
              >
                <MaterialIcon name="check" size={32} className="text-on-secondary-container" />
              </motion.div>
              <h2 className="font-heading text-xl font-bold text-on-surface mb-2">Thank you, {name.split(" ")[0]}!</h2>
              <p className="text-on-surface-variant text-sm mb-6">
                Taking you to WhatsApp to finish booking your demo…
              </p>
              <button
                type="button"
                onClick={goToWhatsApp}
                className="w-full py-3 bg-whatsapp text-white rounded-lg font-bold hover:opacity-90 transition-all flex items-center justify-center gap-2"
              >
                <MaterialIcon name="chat" size={18} />
                Continue Now
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

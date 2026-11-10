"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

export interface ConfirmOptions {
  title: string;
  message: React.ReactNode;
  detail?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: "danger" | "warning" | "primary";
  icon?: string;
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error("useConfirm must be used within a ConfirmModalProvider");
  }
  return context;
}

export function ConfirmModalProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [resolver, setResolver] = useState<((val: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setOptions(opts);
      setResolver(() => resolve);
    });
  }, []);

  const handleClose = useCallback(
    (value: boolean) => {
      if (resolver) {
        resolver(value);
      }
      setOptions(null);
      setResolver(null);
    },
    [resolver]
  );

  // Handle ESC key
  useEffect(() => {
    if (!options) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [options, handleClose]);

  const variant = options?.confirmVariant || "danger";
  const icon =
    options?.icon ||
    (variant === "danger"
      ? "delete_forever"
      : variant === "warning"
      ? "warning"
      : "help_outline");

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {options && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
        >
          <div className="bg-surface-container-lowest rounded-2xl card-shadow w-full max-w-md p-6 flex flex-col border border-outline-variant animate-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div
                className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                  variant === "danger"
                    ? "bg-error-container text-error"
                    : variant === "warning"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-primary-fixed text-primary"
                }`}
              >
                <MaterialIcon name={icon} size={24} />
              </div>
              <button
                type="button"
                onClick={() => handleClose(false)}
                aria-label="Close"
                className="p-1.5 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container transition-all"
              >
                <MaterialIcon name="close" size={20} />
              </button>
            </div>

            <h3 id="confirm-modal-title" className="text-lg font-bold text-on-surface mb-2">
              {options.title}
            </h3>

            <div className="text-sm text-on-surface-variant leading-relaxed mb-4">
              {options.message}
            </div>

            {options.detail && (
              <div className="p-3 bg-surface-container-low rounded-xl border border-outline-variant text-xs text-on-surface-variant leading-relaxed mb-4">
                {options.detail}
              </div>
            )}

            <div className="flex items-center justify-end gap-4 mt-2">
              <button
                type="button"
                onClick={() => handleClose(false)}
                className="px-4 py-2.5 rounded-xl border border-outline-variant text-sm font-semibold text-on-surface-variant hover:bg-surface-container transition-colors"
              >
                {options.cancelText || "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => handleClose(true)}
                className={`px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all flex items-center gap-2 shadow-sm ${
                  variant === "danger"
                    ? "bg-error hover:bg-error/90"
                    : variant === "warning"
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-primary hover:bg-primary-container"
                }`}
              >
                {options.confirmText || (variant === "danger" ? "Delete" : "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}


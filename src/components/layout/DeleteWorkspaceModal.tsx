"use client";

import React, { useEffect } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

interface DeleteWorkspaceModalProps {
  workspaceName: string;
  isDeleting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteWorkspaceModal({
  workspaceName,
  isDeleting,
  onConfirm,
  onClose,
}: DeleteWorkspaceModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isDeleting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDeleting, onClose]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDeleting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-workspace-title"
    >
      <div className="bg-surface-container-lowest rounded-2xl card-shadow w-full max-w-md p-6 flex flex-col border border-outline-variant animate-in zoom-in-95 duration-150">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="w-11 h-11 rounded-xl bg-error-container flex items-center justify-center shrink-0">
            <MaterialIcon name="delete_forever" size={24} className="text-error" />
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            aria-label="Close"
            className="p-1.5 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container transition-all disabled:opacity-50"
          >
            <MaterialIcon name="close" size={20} />
          </button>
        </div>

        <h3 id="delete-workspace-title" className="text-lg font-bold text-on-surface mb-2">
          Delete Workspace?
        </h3>

        <p className="text-sm text-on-surface-variant leading-relaxed mb-3">
          Are you sure you want to delete <span className="font-semibold text-on-surface">"{workspaceName}"</span>?
        </p>

        <div className="p-3 bg-surface-container-low rounded-xl border border-outline-variant text-xs text-on-surface-variant leading-relaxed mb-6">
          It will be removed from your list — you can re-add the business later if needed.
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2.5 rounded-xl border border-outline-variant text-sm font-semibold text-on-surface-variant hover:bg-surface-container transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-error hover:bg-error/90 transition-all flex items-center gap-2 shadow-sm disabled:opacity-60"
          >
            {isDeleting ? (
              <>
                <MaterialIcon name="progress_activity" size={16} className="animate-spin" />
                <span>Deleting…</span>
              </>
            ) : (
              <>
                <MaterialIcon name="delete" size={16} />
                <span>Delete Workspace</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}


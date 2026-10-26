"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "./cn";

/**
 * Built on the native <dialog> element rather than a hand-rolled overlay.
 *
 * `showModal()` gives focus trapping, inertness of the page behind, Escape to
 * close and the top-layer stacking for free, all of which a div-based modal has
 * to reimplement and usually gets wrong.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onClose={onClose}
      // The backdrop is a click target for dismissal; clicks inside the panel
      // stop here so they do not bubble out and close it.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[min(30rem,calc(100vw-2rem))] rounded-card border border-line bg-surface p-0 text-fg",
        "backdrop:bg-fg/40 backdrop:backdrop-blur-sm",
      )}
    >
      <div className="p-6">
        <div className="mb-3 flex items-start justify-between gap-4">
          <h2 id="modal-title" className="text-[22px]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-me-2 -mt-1 rounded-control p-2 text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

"use client";

import { useEffect, useState } from "react";
import { WormSpinner } from "./ui/WormSpinner";

/**
 * Shows the digging worm once the hero form has been submitted.
 *
 * Progressive enhancement, and nothing more: the form it accompanies is a plain
 * GET that already works without JavaScript. This only attaches a listener to
 * the surrounding form so that the moment between pressing Search and the next
 * page arriving is not silent. That silence is what made people think the
 * search was broken.
 *
 * Listening on the parent form rather than owning the submit means the form
 * keeps working exactly as before if this component never loads.
 */
export default function SearchPending() {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const form = document.querySelector<HTMLFormElement>('form[method="get"]');
    if (!form) return;
    const onSubmit = () => setPending(true);
    form.addEventListener("submit", onSubmit);

    // Coming back via the bfcache would otherwise restore a stuck spinner.
    const onShow = () => setPending(false);
    window.addEventListener("pageshow", onShow);

    return () => {
      form.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);

  if (!pending) return null;

  return (
    <div className="mt-4 flex items-center gap-3">
      <WormSpinner size={32} />
      <span className="text-sm font-medium text-fg-2">Digging up jobs…</span>
    </div>
  );
}

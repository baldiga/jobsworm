/**
 * ATS adapter registry - PLAN.md section 4.2.
 *
 * Build order from the plan: Comeet, Greenhouse, Lever, then the rest.
 * Providers not yet implemented are simply absent from the registry; the
 * ingest loop skips a company whose provider has no adapter.
 */

import type { Adapter, AtsProvider } from "./types";
import { comeet } from "./providers/comeet";
import { greenhouse } from "./providers/greenhouse";
import { lever } from "./providers/lever";
import { ashby } from "./providers/ashby";
import { smartrecruiters } from "./providers/smartrecruiters";
import { recruitee } from "./providers/recruitee";

export const registry: Partial<Record<AtsProvider, Adapter>> = {
  comeet,
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  recruitee,
};

export function adapterFor(provider: string | null | undefined): Adapter | null {
  if (!provider) return null;
  return registry[provider as AtsProvider] ?? null;
}

export * from "./types";
export { comeet, greenhouse, lever, ashby, smartrecruiters, recruitee };
export { fetchJson, fetchText, fetchWithRetry, mapLimit, HttpError } from "./http";

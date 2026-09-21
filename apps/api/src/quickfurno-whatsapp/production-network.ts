import type { QuickFurnoWhatsAppHttpPost } from './quickfurno-http.js';

export type QuickFurnoWorkerAvailabilityHttpPost = (
  url: string,
  init: Readonly<{
    method: 'POST';
    headers: Readonly<Record<string, string>>;
    body: string;
    signal: AbortSignal;
    redirect: 'error';
  }>,
) => Promise<{ readonly status: number; text(): Promise<string> }>;

/**
 * The one JF-7 direct HTTP seam.
 *
 * Callers provide the signed/bounded request, abort signal and fixed endpoint. This adapter performs
 * exactly one transport attempt, no redirect following, credential lookup, logging or response interpretation.
 */
export const quickFurnoWorkerHttpPost: QuickFurnoWhatsAppHttpPost = async (url, init) =>
  fetch(url, {
    method: init.method,
    headers: { ...init.headers },
    body: init.body,
    signal: init.signal,
    redirect: init.redirect,
  });

export const quickFurnoWorkerAvailabilityHttpPost: QuickFurnoWorkerAvailabilityHttpPost = async (
  url,
  init,
) =>
  fetch(url, {
    method: init.method,
    headers: { ...init.headers },
    body: init.body,
    signal: init.signal,
    redirect: init.redirect,
  });

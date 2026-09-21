import { statSync } from 'node:fs';

import type { GatewayKillSwitch } from '@qf-jarvis/model-gateway';

/**
 * Filesystem emergency disable for the private WhatsApp worker.
 *
 * Missing file means enabled. Every other outcome (file present, permission failure, I/O failure)
 * means disabled. The caller cannot turn an unreadable control mount into permission to call a model.
 */
export function createQuickFurnoWorkerKillSwitch(path: string): GatewayKillSwitch {
  return Object.freeze({
    active(): boolean {
      try {
        statSync(path);
        return true;
      } catch (error: unknown) {
        return (error as { readonly code?: unknown }).code !== 'ENOENT';
      }
    },
  });
}

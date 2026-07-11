import { z } from 'zod';

/**
 * QF Jarvis contracts — Phase 0A.
 *
 * These are foundation-level primitives only: enough to give the health and
 * metadata surface a single runtime-validated shape shared by the API, the
 * tests, and (later) any consumer. Zod schemas are the source of truth and the
 * TypeScript types are inferred from them, so the runtime check and the compile
 * time type can never drift apart.
 *
 * The full Canonical Event Envelope and the business event system are
 * deliberately NOT here — they belong to Phase 1 (Contracts and Event
 * Foundation).
 */

/**
 * The controlled vocabulary of non-secret, externally observable service
 * states. Kept intentionally small; extend it deliberately rather than passing
 * free-form strings.
 */
export const ServiceStatusSchema = z.enum(['ok', 'ready', 'running', 'degraded', 'error']);
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

/**
 * Response shape for the health probes (`/health/live`, `/health/ready`).
 * `.strict()` rejects unexpected keys so a probe response can never
 * accidentally leak additional fields.
 */
export const HealthResponseSchema = z
  .object({
    status: ServiceStatusSchema,
  })
  .strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/**
 * Response shape for the root metadata endpoint (`/`). Contains only stable,
 * non-secret service identification.
 */
export const ServiceInfoSchema = z
  .object({
    service: z.string().min(1),
    status: ServiceStatusSchema,
    version: z.string().min(1),
  })
  .strict();
export type ServiceInfo = z.infer<typeof ServiceInfoSchema>;

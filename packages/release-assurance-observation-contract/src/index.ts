import { z } from 'zod';

export const RELEASE_ASSURANCE_OBSERVATION_PROTOCOL =
  'qfj.release-assurance-observation.v1' as const;

const instant = z.iso.datetime({ offset: false });
const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);
const label = z.string().min(1).max(160);
const detail = z.string().min(1).max(512);
const releaseSha = z.string().regex(/^[0-9a-f]{40}$/u);

export const releaseAssuranceStateSchema = z.enum([
  'HEALTHY',
  'AVAILABLE',
  'DEGRADED',
  'OFFLINE',
  'SHADOW',
  'ROLLOUT_OFF',
  'PLANNED',
  'DISABLED',
  'NOT_CONNECTED',
]);

export const releaseAssuranceDimensionSchema = z
  .object({
    id: identifier,
    label,
    state: releaseAssuranceStateSchema,
    detail,
  })
  .strict();

export const releaseAssuranceObservationSchema = z
  .object({
    protocol: z.literal(RELEASE_ASSURANCE_OBSERVATION_PROTOCOL),
    emittedAt: instant,
    releaseSha,
    dimensions: z.array(releaseAssuranceDimensionSchema).min(1).max(16),
  })
  .strict();

export type ReleaseAssuranceObservation = z.infer<typeof releaseAssuranceObservationSchema>;

export function parseReleaseAssuranceObservation(value: unknown): ReleaseAssuranceObservation {
  return releaseAssuranceObservationSchema.parse(value);
}

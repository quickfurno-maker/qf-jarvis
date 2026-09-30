import { z } from 'zod';

export interface RiyaClientLifetimeContextV1 {
  readonly version: 1;
  readonly authority: 'QUICKFURNO_CORE_CONTEXT';
  readonly isReturningClient: boolean;
  readonly lastSeenAt: string;
  readonly properties: readonly {
    readonly relation: 'current' | 'historical';
    readonly area?: string;
    readonly propertyType?: string;
    readonly bhk?: string;
    readonly projectStage?: string;
  }[];
  readonly pastServices: readonly {
    readonly serviceRef: string;
    readonly status: 'converted' | 'closed' | 'cancelled';
  }[];
}

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);
const TEXT = z.string().min(1).max(128);
const INSTANT = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u)
  .refine((value) => Number.isFinite(Date.parse(value)));
const propertySchema = z
  .object({
    relation: z.enum(['current', 'historical']),
    area: TEXT.optional(),
    propertyType: TEXT.optional(),
    bhk: TEXT.optional(),
    projectStage: TEXT.optional(),
  })
  .strict();

const pastServiceSchema = z
  .object({
    serviceRef: REF,
    status: z.enum(['converted', 'closed', 'cancelled']),
  })
  .strict();

const schema = z
  .object({
    version: z.literal(1),
    authority: z.literal('QUICKFURNO_CORE_CONTEXT'),
    isReturningClient: z.boolean(),
    lastSeenAt: INSTANT,
    properties: z.array(propertySchema).max(3),
    pastServices: z.array(pastServiceSchema).max(6),
  })
  .strict();
export function parseRiyaClientLifetimeContextV1(value: unknown): RiyaClientLifetimeContextV1 {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error('riya-client-lifetime-context-invalid');

  const propertyKeys = parsed.data.properties.map((property) => JSON.stringify(property));
  if (new Set(propertyKeys).size !== propertyKeys.length) {
    throw new Error('riya-client-lifetime-context-invalid');
  }
  const serviceRefs = parsed.data.pastServices.map((service) => service.serviceRef);
  if (new Set(serviceRefs).size !== serviceRefs.length) {
    throw new Error('riya-client-lifetime-context-invalid');
  }

  return Object.freeze({
    version: 1 as const,
    authority: 'QUICKFURNO_CORE_CONTEXT' as const,
    isReturningClient: parsed.data.isReturningClient,
    lastSeenAt: parsed.data.lastSeenAt,
    properties: Object.freeze(
      parsed.data.properties.map((property) =>
        Object.freeze({
          relation: property.relation,
          ...(property.area === undefined ? {} : { area: property.area }),
          ...(property.propertyType === undefined ? {} : { propertyType: property.propertyType }),
          ...(property.bhk === undefined ? {} : { bhk: property.bhk }),
          ...(property.projectStage === undefined ? {} : { projectStage: property.projectStage }),
        }),
      ),
    ),
    pastServices: Object.freeze(
      parsed.data.pastServices.map((service) =>
        Object.freeze({ serviceRef: service.serviceRef, status: service.status }),
      ),
    ),
  });
}

/**
 * Systems and agents that may appear in a contract.
 *
 * These identifiers are the mechanism by which the permanent architecture
 * boundary is enforced at runtime rather than merely asserted in prose. A
 * contract that names the wrong system as its authority does not parse.
 *
 * See docs/architecture/system-boundary.md — authoritative.
 */

import { z } from 'zod';

/** Every system that may be named anywhere in a contract. */
export const SYSTEM_IDS = [
  'quickfurno-core',
  'qf-jarvis',
  'n8n',
  'qf-communications-runtime',
] as const;

export const systemIdSchema = z.enum(SYSTEM_IDS);
export type SystemId = z.infer<typeof systemIdSchema>;

/**
 * QuickFurno Core is the only authority.
 *
 * It owns business truth, records approval decisions, issues execution intents,
 * and records execution results. Every canonical event reaching Jarvis is
 * emitted by Core, because a fact is only a fact once Core has recorded it
 * (ADR-0001).
 */
export const quickfurnoCoreSchema = z.literal('quickfurno-core');

/**
 * QF Jarvis produces recommendations, and nothing else.
 *
 * It is the only permitted producer of a recommendation, and it is permitted
 * nowhere else: it may not issue an execution intent, and it may not appear as
 * an approval authority. Those are not omissions — they are the boundary
 * (ADR-0002).
 */
export const qfJarvisSchema = z.literal('qf-jarvis');

/** n8n is the only permitted executor of an execution intent. */
export const n8nSchema = z.literal('n8n');

/**
 * Systems that may *report* an execution result as evidence.
 *
 * Reporting is not authority. n8n and the QF Communications Runtime observe
 * what a provider did and report it; the result becomes authoritative only when
 * QuickFurno Core records it and emits the canonical event
 * (docs/architecture/communication-model.md).
 */
export const executionReportingSystemSchema = z.enum(['n8n', 'qf-communications-runtime']);
export type ExecutionReportingSystem = z.infer<typeof executionReportingSystemSchema>;

/** The five agents named in the approved agent model. No others exist. */
export const AGENT_IDS = ['jarvis', 'kabir', 'riya', 'anisha', 'jitin'] as const;

export const agentIdSchema = z.enum(AGENT_IDS);
export type AgentId = z.infer<typeof agentIdSchema>;

/**
 * The four bounded domain specialists.
 *
 * Jarvis is deliberately excluded: it coordinates, it does not conclude. A
 * composite recommendation must attribute its conclusions to specialists, and
 * "Jarvis contributed to a Jarvis composite" would be exactly the disguised
 * Jarvis conclusion that agent-model.md calls a defect.
 */
export const SPECIALIST_AGENT_IDS = ['kabir', 'riya', 'anisha', 'jitin'] as const;

export const specialistAgentIdSchema = z.enum(SPECIALIST_AGENT_IDS);
export type SpecialistAgentId = z.infer<typeof specialistAgentIdSchema>;

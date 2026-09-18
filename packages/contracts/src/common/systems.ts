/**
 * Systems and agents that may appear in a contract.
 *
 * QuickFurno Core Automation is an execution subsystem controlled by QuickFurno Core. It replaces
 * the retired external workflow engine and does not create a second business authority.
 */
import { z } from 'zod';

export const SYSTEM_IDS = [
  'quickfurno-core',
  'quickfurno-core-automation',
  'qf-jarvis',
  'qf-communications-runtime',
] as const;
export const systemIdSchema = z.enum(SYSTEM_IDS);
export type SystemId = z.infer<typeof systemIdSchema>;

/** QuickFurno Core owns business truth and authorization. */
export const quickfurnoCoreSchema = z.literal('quickfurno-core');

/** Core Automation executes only effects authorized by QuickFurno Core. */
export const quickfurnoCoreAutomationSchema = z.literal('quickfurno-core-automation');

/** Jarvis produces recommendations and proposals, never business authority. */
export const qfJarvisSchema = z.literal('qf-jarvis');

/**
 * Systems that may report an execution result as evidence. Reporting is still not authority: Core
 * makes the result authoritative only when it records it and emits the corresponding canonical event.
 */
export const executionReportingSystemSchema = z.enum([
  'quickfurno-core-automation',
  'qf-communications-runtime',
]);
export type ExecutionReportingSystem = z.infer<typeof executionReportingSystemSchema>;

export const AGENT_IDS = ['jarvis', 'kabir', 'riya', 'anisha', 'jitin'] as const;
export const agentIdSchema = z.enum(AGENT_IDS);
export type AgentId = z.infer<typeof agentIdSchema>;

export const SPECIALIST_AGENT_IDS = ['kabir', 'riya', 'anisha', 'jitin'] as const;
export const specialistAgentIdSchema = z.enum(SPECIALIST_AGENT_IDS);
export type SpecialistAgentId = z.infer<typeof specialistAgentIdSchema>;

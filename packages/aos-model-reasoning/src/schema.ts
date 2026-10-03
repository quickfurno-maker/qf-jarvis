import { AOS_RECOMMENDATION_ACTIONS } from '@qf-jarvis/aos-intelligence';
import { z } from 'zod';

export const aosModelRecommendationSchema = z
  .object({
    action: z.enum(AOS_RECOMMENDATION_ACTIONS),
    confidence: z.number().min(0).max(1),
    rootCause: z.string().min(1).max(500),
    rationale: z.string().min(1).max(900),
    alternatives: z.array(z.enum(AOS_RECOMMENDATION_ACTIONS)).max(5),
    needsHumanReview: z.boolean(),
  })
  .strict();

export type AosModelRecommendation = z.infer<typeof aosModelRecommendationSchema>;

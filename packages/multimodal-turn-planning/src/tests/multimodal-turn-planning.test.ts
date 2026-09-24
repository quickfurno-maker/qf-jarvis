import { describe, expect, it } from 'vitest';
import { planMultimodalTurn } from '../index.js';

const processors = [
  {
    processorRef: 'vision.hosted.1',
    executionClass: 'HOSTED' as const,
    certificationRef: 'cert.hosted.1',
    capabilities: ['VISION' as const],
  },
  {
    processorRef: 'vision.local.1',
    executionClass: 'LOCAL' as const,
    certificationRef: 'cert.local.1',
    capabilities: ['VISION' as const, 'AUDIO_TRANSCRIPTION' as const],
  },
] as const;

describe('multimodal turn planning', () => {
  it('keeps text out of media processing', () => {
    expect(
      planMultimodalTurn({ messageType: 'text', dataClass: 'HOSTED_ALLOWED', processors }),
    ).toEqual({ decision: 'TEXT_OR_METADATA_ONLY', mediaProcessing: false });
  });
  it('plans certified image understanding without media-fetch authority', () => {
    expect(
      planMultimodalTurn({
        messageType: 'image',
        dataClass: 'HOSTED_ALLOWED',
        attachment: { kind: 'image', mediaId: 'media.123' },
        processors,
      }),
    ).toMatchObject({
      decision: 'MEDIA_PROCESSING_REQUIRED',
      processorRef: 'vision.local.1',
      requiresQuickFurnoMediaBridge: true,
      providerFetchAuthority: false,
    });
  });
  it('LOCAL_ONLY excludes hosted processing', () => {
    expect(
      planMultimodalTurn({
        messageType: 'image',
        dataClass: 'LOCAL_ONLY',
        attachment: { kind: 'image', mediaId: 'media.123' },
        processors: [processors[0]],
      }),
    ).toEqual({
      decision: 'HUMAN_REQUIRED',
      mediaProcessing: false,
      reason: 'NO_CERTIFIED_PROCESSOR',
    });
  });
  it('HUMAN_ONLY never inspects media', () => {
    expect(
      planMultimodalTurn({
        messageType: 'audio',
        dataClass: 'HUMAN_ONLY',
        attachment: { kind: 'audio', mediaId: 'media.1' },
        processors,
      }),
    ).toEqual({ decision: 'HUMAN_REQUIRED', mediaProcessing: false, reason: 'HUMAN_ONLY' });
  });
});

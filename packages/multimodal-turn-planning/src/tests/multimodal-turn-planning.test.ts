import { describe, expect, it } from 'vitest';

import { planWhatsAppMultimodalTurn } from '../index.js';

describe('multimodal WhatsApp turn planning', () => {
  it('uses already-normalized text without claiming media understanding', () => {
    expect(
      planWhatsAppMultimodalTurn({ messageType: 'text', normalizedText: 'Need a modular kitchen' }),
    ).toEqual({
      decision: 'TEXT_READY',
      usableText: 'Need a modular kitchen',
      mediaUnderstandingClaimed: false,
    });
  });

  it('uses a caption as text but still requires a real media-content boundary', () => {
    expect(
      planWhatsAppMultimodalTurn({
        messageType: 'image',
        attachment: { kind: 'image', mediaId: 'media.1', caption: 'Can you make this style?' },
      }),
    ).toEqual({
      decision: 'CAPTION_ONLY',
      usableText: 'Can you make this style?',
      requiredCapability: 'IMAGE_UNDERSTANDING',
      mediaId: 'media.1',
      contentBoundaryRequired: true,
      mediaUnderstandingClaimed: false,
    });
  });

  it('refuses to hallucinate image/audio/document contents from a media id', () => {
    for (const [kind, requiredCapability] of [
      ['image', 'IMAGE_UNDERSTANDING'],
      ['document', 'DOCUMENT_TEXT_EXTRACTION'],
      ['audio', 'AUDIO_TRANSCRIPTION'],
    ] as const) {
      expect(
        planWhatsAppMultimodalTurn({
          messageType: kind,
          attachment: { kind, mediaId: `media.${kind}` },
        }),
      ).toEqual({
        decision: 'MEDIA_CONTENT_REQUIRED',
        requiredCapability,
        mediaId: `media.${kind}`,
        contentBoundaryRequired: true,
        mediaUnderstandingClaimed: false,
      });
    }
  });

  it('does not create a model turn for unsupported content without safe text', () => {
    expect(planWhatsAppMultimodalTurn({ messageType: 'location' })).toEqual({
      decision: 'NO_MODEL_TURN',
      mediaUnderstandingClaimed: false,
    });
  });

  it('rejects a mismatched attachment type', () => {
    expect(() =>
      planWhatsAppMultimodalTurn({
        messageType: 'audio',
        attachment: { kind: 'image', mediaId: 'media.1' },
      }),
    ).toThrow('multimodal-turn-input-invalid');
  });
});

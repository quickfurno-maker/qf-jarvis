const REF = /^[A-Za-z0-9._:-]{1,256}$/u;

export type MultimodalMessageType =
  | 'text'
  | 'button_reply'
  | 'list_reply'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'reaction'
  | 'order'
  | 'system'
  | 'unsupported';

export interface MultimodalAttachmentReference {
  readonly kind: 'image' | 'document' | 'audio' | 'video' | 'sticker';
  readonly mediaId: string;
  readonly mimeType?: string;
  readonly caption?: string;
  readonly filename?: string;
}

export type MultimodalCapability =
  | 'IMAGE_UNDERSTANDING'
  | 'DOCUMENT_TEXT_EXTRACTION'
  | 'AUDIO_TRANSCRIPTION'
  | 'VIDEO_UNDERSTANDING'
  | 'STICKER_UNDERSTANDING';

export type MultimodalTurnPlan =
  | {
      readonly decision: 'TEXT_READY';
      readonly usableText: string;
      readonly mediaUnderstandingClaimed: false;
    }
  | {
      readonly decision: 'CAPTION_ONLY';
      readonly usableText: string;
      readonly requiredCapability: MultimodalCapability;
      readonly mediaId: string;
      readonly contentBoundaryRequired: true;
      readonly mediaUnderstandingClaimed: false;
    }
  | {
      readonly decision: 'MEDIA_CONTENT_REQUIRED';
      readonly requiredCapability: MultimodalCapability;
      readonly mediaId: string;
      readonly contentBoundaryRequired: true;
      readonly mediaUnderstandingClaimed: false;
    }
  | {
      readonly decision: 'NO_MODEL_TURN';
      readonly mediaUnderstandingClaimed: false;
    };

function capability(kind: MultimodalAttachmentReference['kind']): MultimodalCapability {
  switch (kind) {
    case 'image':
      return 'IMAGE_UNDERSTANDING';
    case 'document':
      return 'DOCUMENT_TEXT_EXTRACTION';
    case 'audio':
      return 'AUDIO_TRANSCRIPTION';
    case 'video':
      return 'VIDEO_UNDERSTANDING';
    case 'sticker':
      return 'STICKER_UNDERSTANDING';
  }
}

export function planWhatsAppMultimodalTurn(input: {
  readonly messageType: MultimodalMessageType;
  readonly normalizedText?: string;
  readonly attachment?: MultimodalAttachmentReference;
}): MultimodalTurnPlan {
  const text = input.normalizedText?.trim();
  if (text !== undefined && text.length > 0 && text.length <= 16_000) {
    return Object.freeze({
      decision: 'TEXT_READY' as const,
      usableText: text,
      mediaUnderstandingClaimed: false as const,
    });
  }
  const attachment = input.attachment;
  if (attachment !== undefined) {
    if (
      !REF.test(attachment.mediaId) ||
      attachment.kind !== input.messageType ||
      (attachment.caption !== undefined && attachment.caption.length > 4096) ||
      (attachment.filename !== undefined && attachment.filename.length > 512) ||
      (attachment.mimeType !== undefined && attachment.mimeType.length > 256)
    ) {
      throw new TypeError('multimodal-turn-input-invalid');
    }
    const requiredCapability = capability(attachment.kind);
    const caption = attachment.caption?.trim();
    if (caption !== undefined && caption.length > 0) {
      return Object.freeze({
        decision: 'CAPTION_ONLY' as const,
        usableText: caption,
        requiredCapability,
        mediaId: attachment.mediaId,
        contentBoundaryRequired: true as const,
        mediaUnderstandingClaimed: false as const,
      });
    }
    return Object.freeze({
      decision: 'MEDIA_CONTENT_REQUIRED' as const,
      requiredCapability,
      mediaId: attachment.mediaId,
      contentBoundaryRequired: true as const,
      mediaUnderstandingClaimed: false as const,
    });
  }
  return Object.freeze({
    decision: 'NO_MODEL_TURN' as const,
    mediaUnderstandingClaimed: false as const,
  });
}

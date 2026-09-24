const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;

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

export type MediaCapability =
  'VISION' | 'DOCUMENT_TEXT_EXTRACTION' | 'AUDIO_TRANSCRIPTION' | 'VIDEO_UNDERSTANDING';

export interface MultimodalProcessor {
  readonly processorRef: string;
  readonly executionClass: 'HOSTED' | 'LOCAL';
  readonly certificationRef: string;
  readonly capabilities: readonly MediaCapability[];
}

export interface MultimodalTurnInput {
  readonly messageType: MultimodalMessageType;
  readonly dataClass: 'HOSTED_ALLOWED' | 'LOCAL_ONLY' | 'HUMAN_ONLY';
  readonly attachment?: {
    readonly kind: 'image' | 'document' | 'audio' | 'video' | 'sticker';
    readonly mediaId: string;
  };
  readonly processors: readonly MultimodalProcessor[];
}

export type MultimodalTurnPlan =
  | { readonly decision: 'TEXT_OR_METADATA_ONLY'; readonly mediaProcessing: false }
  | {
      readonly decision: 'HUMAN_REQUIRED';
      readonly mediaProcessing: false;
      readonly reason: 'HUMAN_ONLY' | 'NO_CERTIFIED_PROCESSOR' | 'UNSUPPORTED_MEDIA';
    }
  | {
      readonly decision: 'MEDIA_PROCESSING_REQUIRED';
      readonly mediaProcessing: true;
      readonly capability: MediaCapability;
      readonly processorRef: string;
      readonly executionClass: 'HOSTED' | 'LOCAL';
      readonly mediaId: string;
      readonly requiresQuickFurnoMediaBridge: true;
      readonly providerFetchAuthority: false;
    };

function capability(kind: NonNullable<MultimodalTurnInput['attachment']>['kind']): MediaCapability {
  if (kind === 'image' || kind === 'sticker') return 'VISION';
  if (kind === 'document') return 'DOCUMENT_TEXT_EXTRACTION';
  if (kind === 'audio') return 'AUDIO_TRANSCRIPTION';
  return 'VIDEO_UNDERSTANDING';
}

export function planMultimodalTurn(input: MultimodalTurnInput): MultimodalTurnPlan {
  if (input.dataClass === 'HUMAN_ONLY') {
    return Object.freeze({
      decision: 'HUMAN_REQUIRED',
      mediaProcessing: false,
      reason: 'HUMAN_ONLY',
    });
  }
  if (
    [
      'text',
      'button_reply',
      'list_reply',
      'location',
      'contact',
      'reaction',
      'order',
      'system',
    ].includes(input.messageType)
  ) {
    return Object.freeze({ decision: 'TEXT_OR_METADATA_ONLY', mediaProcessing: false });
  }
  if (input.messageType === 'unsupported') {
    return Object.freeze({
      decision: 'HUMAN_REQUIRED',
      mediaProcessing: false,
      reason: 'UNSUPPORTED_MEDIA',
    });
  }
  const attachment = input.attachment;
  if (attachment?.kind !== input.messageType || !REF.test(attachment.mediaId)) {
    throw new TypeError('multimodal-turn-invalid');
  }
  const need = capability(attachment.kind);
  const seen = new Set<string>();
  const candidates = input.processors
    .filter((processor) => {
      if (
        !REF.test(processor.processorRef) ||
        !REF.test(processor.certificationRef) ||
        seen.has(processor.processorRef)
      ) {
        throw new TypeError('multimodal-processor-invalid');
      }
      seen.add(processor.processorRef);
      if (input.dataClass === 'LOCAL_ONLY' && processor.executionClass !== 'LOCAL') return false;
      return processor.capabilities.includes(need);
    })
    .sort((a, b) => {
      if (a.executionClass !== b.executionClass) return a.executionClass === 'LOCAL' ? -1 : 1;
      return a.processorRef.localeCompare(b.processorRef);
    });
  const selected = candidates[0];
  if (selected === undefined) {
    return Object.freeze({
      decision: 'HUMAN_REQUIRED',
      mediaProcessing: false,
      reason: 'NO_CERTIFIED_PROCESSOR',
    });
  }
  return Object.freeze({
    decision: 'MEDIA_PROCESSING_REQUIRED',
    mediaProcessing: true,
    capability: need,
    processorRef: selected.processorRef,
    executionClass: selected.executionClass,
    mediaId: attachment.mediaId,
    requiresQuickFurnoMediaBridge: true,
    providerFetchAuthority: false,
  });
}

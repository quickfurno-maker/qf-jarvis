import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('Riya remains a Jarvis-side QuickFurno specialist', () => {
  it('keeps QuickFurno transport outside the Riya conversation service', () => {
    const manifest = JSON.parse(
      read('packages/riya-web-conversation-service/package.json'),
    ) as { dependencies?: Record<string, string> };
    const dependencies = Object.keys(manifest.dependencies ?? {});

    for (const forbidden of [
      '@supabase/supabase-js',
      '@qf-jarvis/quickfurno-gateway',
      '@qf-jarvis/model-gateway',
      '@qf-jarvis/postgres-knowledge-index',
    ]) {
      expect(dependencies).not.toContain(forbidden);
    }
  });

  it('adapts signed QuickFurno material into Riya without provider authority', () => {
    const specialist = read('apps/api/src/quickfurno-whatsapp/specialist-runtime.ts');

    expect(specialist).toContain('runCustomerTurnWorkflow');
    expect(specialist).toContain('processInboundForProposedReply');
    expect(specialist).toContain("RIYA: 'client'");
    expect(specialist).not.toContain('MetaCloudWhatsAppProvider');
    expect(specialist).not.toContain('process.env');
    expect(specialist).not.toContain('@supabase/');
  });

  it('returns proposals through the signed QuickFurno reply writer', () => {
    const processor = read('apps/api/src/quickfurno-whatsapp/turn-processor.ts');
    const worker = read('apps/api/src/quickfurno-whatsapp/production-worker.ts');

    expect(processor).toContain('replyWriter.write');
    expect(worker).toContain('createQuickFurnoWhatsAppMaterialReader');
    expect(worker).toContain('createQuickFurnoWhatsAppConversationContextReader');
    expect(worker).toContain('createQuickFurnoWhatsAppReplyWriter');
    expect(worker).toContain('createQuickFurnoWhatsAppSpecialistRuntime');
  });

  it('treats conversation context as explicitly non-authoritative', () => {
    const contracts = read('apps/api/src/quickfurno-whatsapp/contracts.ts');

    expect(contracts).toContain("'NON_AUTHORITATIVE_CONVERSATION_CONTEXT'");
    expect(contracts).toContain("tenantId: 'quickfurno'");
    expect(contracts).toContain("readonly actor: 'RIYA'");
  });

  it('keeps QuickFurno business authority out of the Riya prompt package runtime', () => {
    const manifest = JSON.parse(read('packages/riya-prompts/package.json')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/prompt-registry',
      '@qf-jarvis/riya-model-interaction',
    ]);
  });
});

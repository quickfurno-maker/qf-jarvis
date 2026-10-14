// VOX-05: one-time server-to-server Jarvis envelope consumption boundary.
// Does not create a route, send Meta messages or expose long-term memory.
// Caller MUST inject real atomic durable claim() storage keyed by issuer+jti.
import { verifyAgentView } from './agentView.mjs';
const REPLAY_TTL_CAP_SECONDS = 300;
export async function verifyOnceAgentView(
  token,
  secret,
  store,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (!store || typeof store.claimOnce !== 'function')
    throw new Error('DURABLE_REPLAY_STORE_REQUIRED');
  const view = verifyAgentView(token, secret, nowSeconds);
  if (view.replayCheckRequired !== true || !view.jti) throw new Error('REPLAY_ENVELOPE_INVALID');
  if (view.expiresAt - nowSeconds > REPLAY_TTL_CAP_SECONDS || view.expiresAt <= nowSeconds)
    throw new Error('INVALID_AGENT_TTL');
  // Must be atomic SET NX with expiry in real backend; never use a local Map in
  // deployed multi-instance Jarvis/VOX. Fail closed on false/error/timeout.
  const key = 'qf.vox.agent.view.v1:qf-jarvis:' + view.jti;
  const claimed = await store.claimOnce(key, view.expiresAt);
  if (claimed !== true) throw new Error('REPLAY_OR_STORE_UNAVAILABLE');
  const safe = { ...view };
  delete safe.jti;
  delete safe.replayCheckRequired;
  return Object.freeze({ ...safe, proofConsumed: true, permissions: Object.freeze(['READ_ONLY']) });
}
export function requiresCoreAttestationForHandoff(view, attestation) {
  if (!view || view.agent !== 'AAROHI' || view.subjectType !== 'prospect') return false;
  // A "won" status, a shared phone or an agent assertion is NEVER Core proof.
  return Boolean(
    attestation &&
    attestation.verifiedByCore === true &&
    attestation.prospectId === view.subjectId &&
    attestation.vendorId &&
    attestation.activeVendor === true &&
    attestation.registrationIntentConsumed === true,
  );
}

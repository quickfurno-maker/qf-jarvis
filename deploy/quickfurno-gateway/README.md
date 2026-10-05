# QuickFurno -> Jarvis gateway

This deployment is the dedicated machine-to-machine boundary between QuickFurno Core and the
separate Jarvis VPS. It is intentionally not part of Jarvis OS.

## Boundary

- Public hostname: `gateway.jarvis.quickfurno.in`.
- Only the QuickFurno production VPS IP is admitted at Traefik.
- Every handshake request must also carry a fresh Ed25519 signature.
- The gateway stores no Meta, WhatsApp, Supabase, QuickFurno database, or provider credential.
- QuickFurno Core remains final business and communication authority.
- Jarvis remains advisory/coordinating; this gateway does not authorize a business action.
- Jarvis OS remains an operator UI and is not in the machine path.

## Runtime secret file

The machine-auth contract is supplied by the read-only file:

`/srv/qf-jarvis/secrets/qf-jarvis-gateway.json`

Database configuration and its CA are mounted separately. None of these files enters
an OCI layer or an environment value.

Example **shape only**:

```json
{
  "schemaVersion": 1,
  "environment": "production",
  "serviceId": "qf-jarvis.quickfurno-gateway",
  "quickfurnoVerificationKeys": [
    {
      "keyId": "quickfurno-prod-YYYY-MM",
      "publicKeyPem": "<QuickFurno PUBLIC Ed25519 key PEM>"
    }
  ],
  "jarvisSigningKey": {
    "keyId": "jarvis-gateway-prod-YYYY-MM",
    "privateKeyPem": "<Jarvis PRIVATE Ed25519 key PEM>"
  },
  "maxClockSkewMs": 60000,
  "replayTtlMs": 120000,
  "replayMaxEntries": 10000
}
```

Never commit the real file. The QuickFurno private key remains on the QuickFurno deployment
boundary; the Jarvis private key remains on the Jarvis deployment boundary.

For zero-downtime rotation, add the next public key beside the current one, switch
the sender to the new key only after receivers accept both, then remove the old
public key after the overlap window. The gateway accepts up to four unique
verification keys, so rotation does not require rebuilding the image.

## Activation gates

1. Merge an exact reviewed SHA.
2. Create DNS A/AAAA as appropriate for `gateway.jarvis.quickfurno.in`.
3. Generate the two directional Ed25519 keypairs on their owning VPSs.
4. Install only the opposite side's public key.
5. Build the SHA-tagged image.
6. Start the private compose file first and prove `/healthz` from inside the host.
7. Apply the ingress overlay.
8. Verify trusted TLS.
9. Send one signed connectivity canary from QuickFurno and verify the signed Jarvis response.
10. Do not add WhatsApp turns until the handshake is independently verified.

The handshake endpoint is side-effect free. The in-process replay cache prevents ordinary duplicate
delivery on one replica. Future state-changing/multi-replica endpoints must additionally use a
shared idempotency/replay authority; they must not infer that an in-memory cache is sufficient.

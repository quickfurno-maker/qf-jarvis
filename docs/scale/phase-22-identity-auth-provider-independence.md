# Phase 22 — Identity & Auth Provider Independence

Jarvis does not authenticate QuickFurno end users and gains no identity-provider authority in Phase 22.

QuickFurno Core owns stable internal principals, provider mappings and all business authorization. Jarvis continues to receive only governed/signed service context through the existing QuickFurno↔Jarvis contract. A Supabase/OIDC/SAML subject or token never becomes a Jarvis authorization primitive.

The canonical `qfj.phase22.identity-auth.v1` contract requires provider cutovers to invalidate/re-authenticate end-user sessions rather than bridge provider refresh tokens. Password, MFA and recovery migration remain provider-specific and fail closed.

No production IdP cutover, DB mutation, session invalidation or Jarvis authority expansion occurs in Phase 22.

**Next:** Phase 23 — API & Event Compatibility Contracts.

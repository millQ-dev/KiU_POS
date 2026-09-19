# ID1.1 — Identity / POS Authentication Foundation

- **Status:** Implemented (Level B)
- **Architecture:** ADR-0036 Accepted @ `e94e3cf`
- **Scope:** Company locator, Terminal, User/PIN/AccessGrant/Session, Employee link, LoginChallenge/ApprovalRequest foundations
- **Out:** CashShift mutation, DeviceIdentity, push vendor, production QR completion without mobile principal (confirm marks challenge only)

## CSRF / cookie strategy

- Session cookie `millq_session`: HttpOnly, Path=/, SameSite=Lax, Secure in production
- No bearer token returned for JS storage
- State-changing authenticated routes validate `Origin` (or `Referer`) against `CORS_ORIGINS`
- Production rejects missing Origin/Referer on mutating routes

## Rate limiting

- In-memory fixed window (single-node). Documented limitation for multi-instance.
- Durable lockout: `identity_auth_throttle` + per-credential `failed_attempts` (atomic SQL)

## Pepper

- `IDENTITY_PIN_PEPPER` env (required in production, min 32 chars). Never in DB/client.

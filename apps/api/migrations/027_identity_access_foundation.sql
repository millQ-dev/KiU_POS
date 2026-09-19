-- Identity / Workforce auth foundation (ADR-0036 ID1.1).
-- Identity owns User, PIN, AccessGrant, Session, LoginChallenge, ApprovalRequest, audit, outbox.
-- Workforce owns Employee (+ optional User link). No CashShift. DeviceIdentity deferred (NULL only).

CREATE TABLE identity_user (
  user_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT identity_user_status_ck CHECK (status IN ('ACTIVE', 'DISABLED')),
  CONSTRAINT identity_user_display_nonempty CHECK (length(trim(display_name)) > 0),
  CONSTRAINT identity_user_tenant_uq UNIQUE (user_id, tenant_id)
);

CREATE INDEX identity_user_tenant_idx ON identity_user (tenant_id);

CREATE TABLE workforce_employee (
  employee_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  display_name TEXT NOT NULL,
  user_id UUID NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workforce_employee_status_ck CHECK (status IN ('ACTIVE', 'DISABLED')),
  CONSTRAINT workforce_employee_display_nonempty CHECK (length(trim(display_name)) > 0),
  CONSTRAINT workforce_employee_user_uq UNIQUE (user_id),
  CONSTRAINT workforce_employee_user_tenant_fk
    FOREIGN KEY (user_id, tenant_id) REFERENCES identity_user (user_id, tenant_id)
);

CREATE INDEX workforce_employee_tenant_idx ON workforce_employee (tenant_id);

-- PIN credential: scrypt(pin, salt, pepper); pepper OUTSIDE DB. pin_lookup = HMAC for indexed auth.
CREATE TABLE identity_pin_credential (
  user_id UUID PRIMARY KEY REFERENCES identity_user (user_id),
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  pin_lookup_hash TEXT NOT NULL,
  kdf_version INT NOT NULL DEFAULT 1,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT identity_pin_hash_nonempty CHECK (length(trim(pin_hash)) > 0),
  CONSTRAINT identity_pin_salt_nonempty CHECK (length(trim(pin_salt)) > 0),
  CONSTRAINT identity_pin_lookup_nonempty CHECK (length(trim(pin_lookup_hash)) = 64),
  CONSTRAINT identity_pin_failed_nonneg CHECK (failed_attempts >= 0),
  CONSTRAINT identity_pin_kdf_version_pos CHECK (kdf_version >= 1),
  CONSTRAINT identity_pin_user_tenant_fk
    FOREIGN KEY (user_id, tenant_id) REFERENCES identity_user (user_id, tenant_id)
);

CREATE UNIQUE INDEX identity_pin_lookup_tenant_uq
  ON identity_pin_credential (tenant_id, pin_lookup_hash);

-- Atomic auth throttle (company/IP/candidate dimensions). Persistent lockout truth.
CREATE TABLE identity_auth_throttle (
  throttle_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  dimension TEXT NOT NULL,
  dim_key TEXT NOT NULL,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT identity_auth_throttle_dim_ck CHECK (
    dimension IN ('IP', 'COMPANY_IP', 'PIN_CANDIDATE')
  ),
  CONSTRAINT identity_auth_throttle_failed_nonneg CHECK (failed_attempts >= 0),
  CONSTRAINT identity_auth_throttle_uq UNIQUE (tenant_id, dimension, dim_key)
);

-- Pre-tenant / unknown-company network throttle (no tenant_id required).
CREATE TABLE identity_network_throttle (
  dim_key TEXT PRIMARY KEY,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT identity_network_throttle_failed_nonneg CHECK (failed_attempts >= 0)
);

CREATE TABLE identity_permission (
  permission_key TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  CONSTRAINT identity_permission_key_format CHECK (permission_key ~ '^[a-z][a-z0-9_.]*$')
);

INSERT INTO identity_permission (permission_key, description) VALUES
  ('cash_shift.open', 'Authorize opening a CashShift after required confirmations (CASH1.1)'),
  ('cash_shift.open.approve', 'Approve one-time CashShift open ApprovalRequest (CASH1.1)')
ON CONFLICT DO NOTHING;

CREATE TABLE identity_access_grant (
  access_grant_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  user_id UUID NOT NULL,
  permission_key TEXT NOT NULL REFERENCES identity_permission (permission_key),
  outlet_id UUID NULL,
  terminal_id UUID NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT identity_access_grant_user_tenant_fk
    FOREIGN KEY (user_id, tenant_id) REFERENCES identity_user (user_id, tenant_id),
  CONSTRAINT identity_access_grant_outlet_tenant_fk
    FOREIGN KEY (outlet_id, tenant_id) REFERENCES outlet (outlet_id, tenant_id),
  CONSTRAINT identity_access_grant_terminal_fk
    FOREIGN KEY (terminal_id) REFERENCES terminal (terminal_id)
);

CREATE UNIQUE INDEX identity_access_grant_tenant_wide_uq
  ON identity_access_grant (tenant_id, user_id, permission_key)
  WHERE outlet_id IS NULL AND terminal_id IS NULL AND enabled AND revoked_at IS NULL;

CREATE UNIQUE INDEX identity_access_grant_outlet_uq
  ON identity_access_grant (tenant_id, user_id, permission_key, outlet_id)
  WHERE outlet_id IS NOT NULL AND terminal_id IS NULL AND enabled AND revoked_at IS NULL;

CREATE INDEX identity_access_grant_user_idx
  ON identity_access_grant (tenant_id, user_id)
  WHERE enabled AND revoked_at IS NULL;

-- Session: store SHA-256 of bearer only. Cookie carries secret (HttpOnly).
CREATE TABLE identity_session (
  session_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  user_id UUID NOT NULL,
  employee_id UUID NULL REFERENCES workforce_employee (employee_id),
  token_hash TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'TERMINAL',
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT identity_session_user_tenant_fk
    FOREIGN KEY (user_id, tenant_id) REFERENCES identity_user (user_id, tenant_id),
  CONSTRAINT identity_session_token_hash_uq UNIQUE (token_hash),
  CONSTRAINT identity_session_token_hash_len CHECK (length(trim(token_hash)) = 64),
  CONSTRAINT identity_session_channel_ck CHECK (channel IN ('TERMINAL', 'MOBILE'))
);

CREATE INDEX identity_session_user_idx ON identity_session (tenant_id, user_id)
  WHERE revoked_at IS NULL;

-- LoginChallenge schema (ADR-0036). Confirm requires authenticated mobile principal.
-- Possession of qrToken alone MUST NOT authenticate or create a cashier Session.
CREATE TABLE identity_login_challenge (
  login_challenge_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  outlet_id UUID NOT NULL,
  terminal_id UUID NOT NULL REFERENCES terminal (terminal_id),
  user_id UUID NOT NULL,
  employee_id UUID NULL REFERENCES workforce_employee (employee_id),
  session_id UUID NOT NULL REFERENCES identity_session (session_id),
  challenge_token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ NULL,
  confirmed_by_session_id UUID NULL REFERENCES identity_session (session_id),
  consumed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT identity_login_challenge_user_tenant_fk
    FOREIGN KEY (user_id, tenant_id) REFERENCES identity_user (user_id, tenant_id),
  CONSTRAINT identity_login_challenge_token_uq UNIQUE (challenge_token_hash),
  CONSTRAINT identity_login_challenge_token_len CHECK (length(trim(challenge_token_hash)) = 64),
  CONSTRAINT identity_login_challenge_status_ck CHECK (
    status IN ('PENDING', 'CONFIRMED', 'EXPIRED', 'CONSUMED', 'REJECTED', 'CANCELLED')
  ),
  CONSTRAINT identity_login_challenge_outlet_tenant_fk
    FOREIGN KEY (outlet_id, tenant_id) REFERENCES outlet (outlet_id, tenant_id)
);

CREATE INDEX identity_login_challenge_pending_idx
  ON identity_login_challenge (tenant_id, user_id, status)
  WHERE status = 'PENDING';

-- ApprovalRequest foundation (no CashShift mutation in ID1.1). Fingerprint binds exact op.
CREATE TABLE identity_approval_request (
  approval_request_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  outlet_id UUID NOT NULL,
  terminal_id UUID NOT NULL REFERENCES terminal (terminal_id),
  requester_user_id UUID NOT NULL,
  requester_employee_id UUID NULL REFERENCES workforce_employee (employee_id),
  operation_type TEXT NOT NULL,
  operation_fingerprint JSONB NOT NULL,
  login_challenge_id UUID NULL REFERENCES identity_login_challenge (login_challenge_id),
  status TEXT NOT NULL DEFAULT 'PENDING',
  expires_at TIMESTAMPTZ NOT NULL,
  decided_by_user_id UUID NULL,
  decided_at TIMESTAMPTZ NULL,
  consumed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT identity_approval_requester_fk
    FOREIGN KEY (requester_user_id, tenant_id) REFERENCES identity_user (user_id, tenant_id),
  CONSTRAINT identity_approval_decider_fk
    FOREIGN KEY (decided_by_user_id, tenant_id) REFERENCES identity_user (user_id, tenant_id),
  CONSTRAINT identity_approval_status_ck CHECK (
    status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'CONSUMED')
  ),
  CONSTRAINT identity_approval_outlet_tenant_fk
    FOREIGN KEY (outlet_id, tenant_id) REFERENCES outlet (outlet_id, tenant_id)
);

CREATE INDEX identity_approval_pending_idx
  ON identity_approval_request (tenant_id, outlet_id, status)
  WHERE status = 'PENDING';

CREATE TABLE identity_audit_event (
  audit_event_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  event_type TEXT NOT NULL,
  actor_user_id UUID NULL,
  subject_ref TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT identity_audit_event_type_nonempty CHECK (length(trim(event_type)) > 0)
);

CREATE INDEX identity_audit_event_tenant_idx
  ON identity_audit_event (tenant_id, occurred_at DESC);

CREATE TABLE identity_notification_outbox (
  notification_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant (tenant_id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ NULL,
  CONSTRAINT identity_notification_status_ck CHECK (status IN ('PENDING', 'DELIVERED', 'FAILED'))
);

COMMENT ON TABLE identity_pin_credential IS
  'PIN is LOW ENTROPY. Requires pepper outside DB + atomic lockout/throttle (ADR-0036).';
COMMENT ON TABLE identity_login_challenge IS
  'QR token possession alone never authenticates; mobile principal required to confirm.';
COMMENT ON TABLE identity_approval_request IS
  'Dangerous-op approval evidence only; does not open CashShift in ID1.1.';

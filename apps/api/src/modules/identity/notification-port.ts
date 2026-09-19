import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export type NotificationEventType = 'DANGEROUS_OPERATION_APPROVAL_REQUESTED';

/** Safe display metadata only — never PIN/session/qrToken/hashes. */
export type DangerousOperationApprovalRequested = {
  readonly type: 'DANGEROUS_OPERATION_APPROVAL_REQUESTED';
  readonly tenantId: string;
  readonly outletId: string;
  readonly terminalId: string;
  readonly approvalRequestId: string;
  readonly requesterUserId: string;
  readonly requesterEmployeeId: string | null;
  readonly requesterDisplayName: string;
  readonly operationType: string;
  readonly expiresAt: string;
  readonly createdAt: string;
};

export type NotificationEvent = DangerousOperationApprovalRequested;

export interface NotificationPort {
  enqueue(event: NotificationEvent): Promise<void>;
}

export class OutboxNotificationPort implements NotificationPort {
  constructor(private readonly pool: Pool) {}

  async enqueue(event: NotificationEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO identity_notification_outbox
         (notification_id, tenant_id, event_type, payload, status)
       VALUES ($1,$2,$3,$4::jsonb,'PENDING')`,
      [randomUUID(), event.tenantId, event.type, JSON.stringify(event)],
    );
  }
}

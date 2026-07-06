import crypto from 'crypto';
import { db } from '../models/db';
import { IAuditEvent, AuditActionType } from '../models/types';

/**
 * Calculates the SHA-256 hash of an audit event.
 */
export function calculateEventHash(
  prevHash: string,
  grantId: string | null,
  actorId: string,
  actionType: AuditActionType,
  target: string,
  amount: number | null,
  timestamp: Date,
  isAnomaly: boolean = false,
  anomalyReason: string = ''
): string {
  const data = [
    prevHash,
    grantId || 'null',
    actorId,
    actionType,
    target,
    amount !== null ? amount.toString() : 'null',
    timestamp.toISOString(),
    isAnomaly ? 'true' : 'false',
    anomalyReason
  ].join('|');

  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Creates and appends a new audit event to the hash chain.
 */
export async function logAuditEvent(
  grantId: string | null,
  actorId: string,
  actionType: AuditActionType,
  target: string,
  amount: number | null = null,
  isAnomaly: boolean = false,
  anomalyReason: string = ''
): Promise<IAuditEvent> {
  // Fetch the latest global audit event to chain hashes
  const latestEvent = await db.audit.findLatest();
  const prevHash = latestEvent ? latestEvent.eventHash : '0000000000000000000000000000000000000000000000000000000000000000';
  const timestamp = new Date();

  const eventHash = calculateEventHash(
    prevHash,
    grantId,
    actorId,
    actionType,
    target,
    amount,
    timestamp,
    isAnomaly,
    anomalyReason
  );

  const event = await db.audit.create({
    grantId,
    actorId,
    actionType,
    target,
    amount,
    timestamp,
    prevEventHash: prevHash,
    eventHash,
    isAnomaly,
    anomalyReason
  });

  return event;
}

/**
 * Verifies the integrity of the entire audit log chain.
 * Returns true if all hashes are validly linked, false if any tampering is detected.
 */
export async function verifyAuditChain(): Promise<{ valid: boolean; brokenIndex?: number }> {
  const events = await db.audit.find({});
  if (events.length === 0) {
    return { valid: true };
  }

  // Validate the first block
  let expectedPrevHash = '0000000000000000000000000000000000000000000000000000000000000000';
  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // Check if the prevEventHash matches the expected hash from the previous block
    if (event.prevEventHash !== expectedPrevHash) {
      console.error(`[AUDIT CHAINGUARD] Tampering detected! Broken chain link at event index ${i}. Expected prev hash: ${expectedPrevHash}, found: ${event.prevEventHash}`);
      return { valid: false, brokenIndex: i };
    }

    // Recalculate hash of current block
    const calculatedHash = calculateEventHash(
      event.prevEventHash,
      event.grantId,
      event.actorId,
      event.actionType,
      event.target,
      event.amount,
      event.timestamp,
      event.isAnomaly || false,
      event.anomalyReason || ''
    );

    if (event.eventHash !== calculatedHash) {
      console.error(`[AUDIT CHAINGUARD] Tampering detected! Hash mismatch at event index ${i}. Calculated: ${calculatedHash}, stored: ${event.eventHash}`);
      return { valid: false, brokenIndex: i };
    }

    // Set expected hash for the next event
    expectedPrevHash = event.eventHash;
  }

  return { valid: true };
}

import cron from 'node-cron';
import { db } from '../models/db';
import { logAuditEvent } from './crypto';

export function initCronJobs(io: any) {
  console.log('[CRON] Initializing grant expiration checker (running every minute)...');

  // Check every minute
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const expiredGrants = await db.grants.findExpired(now);

      for (const grant of expiredGrants) {
        console.log(`[CRON] Grant ${grant._id} has expired (expired at ${grant.expiresAt.toISOString()}). Updating status.`);

        // Update status to expired
        await db.grants.updateOne(grant._id, { status: 'expired' });

        // Log the expiration event in the audit trail
        const audit = await logAuditEvent(
          grant._id,
          'SYSTEM', // System role
          'grant_expired',
          `Grant ID ${grant._id} for delegate ID ${grant.delegateId} expired automatically.`,
          null
        );

        // Broadcast to all connected clients
        io.emit('audit_event', audit);
        io.emit('grant_expired', {
          grantId: grant._id,
          delegateId: grant.delegateId,
          domain: grant.domain
        });
      }
    } catch (err) {
      console.error('[CRON] Error checking expired grants:', err);
    }
  });
}

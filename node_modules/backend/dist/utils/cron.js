"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initCronJobs = initCronJobs;
const node_cron_1 = __importDefault(require("node-cron"));
const db_1 = require("../models/db");
const crypto_1 = require("./crypto");
function initCronJobs(io) {
    console.log('[CRON] Initializing grant expiration checker (running every minute)...');
    // Check every minute
    node_cron_1.default.schedule('* * * * *', async () => {
        try {
            const now = new Date();
            const expiredGrants = await db_1.db.grants.findExpired(now);
            for (const grant of expiredGrants) {
                console.log(`[CRON] Grant ${grant._id} has expired (expired at ${grant.expiresAt.toISOString()}). Updating status.`);
                // Update status to expired
                await db_1.db.grants.updateOne(grant._id, { status: 'expired' });
                // Log the expiration event in the audit trail
                const audit = await (0, crypto_1.logAuditEvent)(grant._id, 'SYSTEM', // System role
                'grant_expired', `Grant ID ${grant._id} for delegate ID ${grant.delegateId} expired automatically.`, null);
                // Broadcast to all connected clients
                io.emit('audit_event', audit);
                io.emit('grant_expired', {
                    grantId: grant._id,
                    delegateId: grant.delegateId,
                    domain: grant.domain
                });
            }
        }
        catch (err) {
            console.error('[CRON] Error checking expired grants:', err);
        }
    });
}

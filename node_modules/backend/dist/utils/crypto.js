"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateEventHash = calculateEventHash;
exports.logAuditEvent = logAuditEvent;
exports.verifyAuditChain = verifyAuditChain;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../models/db");
/**
 * Calculates the SHA-256 hash of an audit event.
 */
function calculateEventHash(prevHash, grantId, actorId, actionType, target, amount, timestamp) {
    const data = [
        prevHash,
        grantId || 'null',
        actorId,
        actionType,
        target,
        amount !== null ? amount.toString() : 'null',
        timestamp.toISOString()
    ].join('|');
    return crypto_1.default.createHash('sha256').update(data).digest('hex');
}
/**
 * Creates and appends a new audit event to the hash chain.
 */
async function logAuditEvent(grantId, actorId, actionType, target, amount = null) {
    // Fetch the latest global audit event to chain hashes
    const latestEvent = await db_1.db.audit.findLatest();
    const prevHash = latestEvent ? latestEvent.eventHash : '0000000000000000000000000000000000000000000000000000000000000000';
    const timestamp = new Date();
    const eventHash = calculateEventHash(prevHash, grantId, actorId, actionType, target, amount, timestamp);
    const event = await db_1.db.audit.create({
        grantId,
        actorId,
        actionType,
        target,
        amount,
        timestamp,
        prevEventHash: prevHash,
        eventHash
    });
    return event;
}
/**
 * Verifies the integrity of the entire audit log chain.
 * Returns true if all hashes are validly linked, false if any tampering is detected.
 */
async function verifyAuditChain() {
    const events = await db_1.db.audit.find({});
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
        const calculatedHash = calculateEventHash(event.prevEventHash, event.grantId, event.actorId, event.actionType, event.target, event.amount, event.timestamp);
        if (event.eventHash !== calculatedHash) {
            console.error(`[AUDIT CHAINGUARD] Tampering detected! Hash mismatch at event index ${i}. Calculated: ${calculatedHash}, stored: ${event.eventHash}`);
            return { valid: false, brokenIndex: i };
        }
        // Set expected hash for the next event
        expectedPrevHash = event.eventHash;
    }
    return { valid: true };
}

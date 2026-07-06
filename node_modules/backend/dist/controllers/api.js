"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupRoutes = setupRoutes;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../models/db");
const auth_1 = require("../middleware/auth");
const AgentServices_1 = require("../services/AgentServices");
const crypto_1 = require("../utils/crypto");
const exports_1 = require("../utils/exports");
function setupRoutes(app, io) {
    // ----------------------------------------------------
    // AUTH ROUTES
    // ----------------------------------------------------
    // Register a new user
    app.post('/api/auth/register', async (req, res) => {
        try {
            const { name, email, password, role, familyId } = req.body;
            if (!name || !email || !password || !role || !familyId) {
                return res.status(400).json({ message: 'All fields are required.' });
            }
            // Check if user exists
            const existing = await db_1.db.users.findOne({ email });
            if (existing) {
                return res.status(400).json({ message: 'User with this email already exists.' });
            }
            const passwordHash = bcryptjs_1.default.hashSync(password, 10);
            const user = await db_1.db.users.create({
                name,
                email,
                password: passwordHash,
                role,
                familyId
            });
            return res.status(201).json({
                message: 'User registered successfully',
                user: { id: user._id, name: user.name, email: user.email, role: user.role, familyId: user.familyId }
            });
        }
        catch (err) {
            return res.status(500).json({ message: err.message });
        }
    });
    // Login user
    app.post('/api/auth/login', async (req, res) => {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return res.status(400).json({ message: 'Email and password are required.' });
            }
            const user = await db_1.db.users.findOne({ email });
            if (!user || !user.password) {
                return res.status(401).json({ message: 'Invalid credentials.' });
            }
            const isMatch = bcryptjs_1.default.compareSync(password, user.password);
            if (!isMatch) {
                return res.status(401).json({ message: 'Invalid credentials.' });
            }
            const token = jsonwebtoken_1.default.sign({ id: user._id, email: user.email, role: user.role, familyId: user.familyId }, auth_1.JWT_SECRET, { expiresIn: '1d' });
            return res.json({
                token,
                user: { id: user._id, name: user.name, email: user.email, role: user.role, familyId: user.familyId }
            });
        }
        catch (err) {
            return res.status(500).json({ message: err.message });
        }
    });
    // Setup/Seed Demo Environment
    app.post('/api/auth/setup-demo', async (req, res) => {
        try {
            const familyId = 'demo-family-123';
            // Check if demo users already seeded to prevent duplicate key errors
            const demoUsers = await db_1.db.users.find({ familyId });
            if (demoUsers.length > 0) {
                return res.json({ message: 'Demo environment already set up.' });
            }
            const passHash = bcryptjs_1.default.hashSync('password123', 10);
            // Create Parent Jo, Delegate Priya (Primary), Sam (Secondary), Sarah (Skeptical Sibling)
            const users = await AgentServices_1.IntakeAgent.setupFamily(familyId, {
                name: 'Jo (Parent)',
                email: 'jo@example.com',
                passwordHash: passHash
            }, [
                { name: 'Priya (Primary Delegate)', email: 'priya@example.com', passwordHash: passHash, role: 'delegate' },
                { name: 'Sam (Co-signer Sibling)', email: 'sam@example.com', passwordHash: passHash, role: 'co_signer' },
                { name: 'Sarah (Co-signer Sibling)', email: 'sarah@example.com', passwordHash: passHash, role: 'co_signer' }
            ]);
            return res.json({
                message: 'Demo environment initialized successfully. Seeded users (password: password123)',
                users: users.map(u => ({ id: u._id, name: u.name, email: u.email, role: u.role, familyId: u.familyId }))
            });
        }
        catch (err) {
            return res.status(500).json({ message: err.message });
        }
    });
    // ----------------------------------------------------
    // GRANT ROUTES
    // ----------------------------------------------------
    // Create a new grant (only parent can create)
    app.post('/api/grants', auth_1.authMiddleware, async (req, res) => {
        try {
            const { delegateId, scope, domain, reason, startAt, expiresAt, coSigners, transactionCap, monthlyCap } = req.body;
            const parentUser = req.user;
            if (parentUser.role !== 'parent') {
                return res.status(403).json({ message: 'Only parents can grant account delegations.' });
            }
            const newGrant = await AgentServices_1.GrantAgent.createGrant({
                parentId: parentUser.id,
                delegateId,
                scope,
                domain,
                reason,
                createdBy: parentUser.id,
                startAt: new Date(startAt),
                expiresAt: new Date(expiresAt),
                coSigners: coSigners || [],
                parentAck: true,
                transactionCap: Number(transactionCap) || 0,
                monthlyCap: Number(monthlyCap) || 0
            });
            // Broadcast Socket update
            io.emit('grant_created', newGrant);
            const audit = await db_1.db.audit.findLatest();
            if (audit)
                io.emit('audit_event', audit);
            return res.status(201).json(newGrant);
        }
        catch (err) {
            return res.status(400).json({ message: err.message });
        }
    });
    // List all grants for the user's family
    app.get('/api/grants', auth_1.authMiddleware, async (req, res) => {
        try {
            const user = req.user;
            let query = {};
            if (user.role === 'delegate') {
                query.delegateId = user.id;
            }
            else {
                query.parentId = await getParentIdForFamily(user.familyId);
            }
            const grants = await db_1.db.grants.find(query);
            return res.json(grants);
        }
        catch (err) {
            return res.status(500).json({ message: err.message });
        }
    });
    // Revoke a grant (only parent can revoke)
    app.delete('/api/grants/:id', auth_1.authMiddleware, async (req, res) => {
        try {
            const parentUser = req.user;
            if (parentUser.role !== 'parent') {
                return res.status(403).json({ message: 'Only parents can revoke delegation grants.' });
            }
            const revokedGrant = await AgentServices_1.GrantAgent.revokeGrant(req.params.id, parentUser.id);
            io.emit('grant_revoked', revokedGrant);
            const audit = await db_1.db.audit.findLatest();
            if (audit)
                io.emit('audit_event', audit);
            return res.json(revokedGrant);
        }
        catch (err) {
            return res.status(400).json({ message: err.message });
        }
    });
    // Renew an expired/revoked grant (only parent)
    app.post('/api/grants/:id/renew', auth_1.authMiddleware, async (req, res) => {
        try {
            const parentUser = req.user;
            if (parentUser.role !== 'parent') {
                return res.status(403).json({ message: 'Only parents can renew delegation grants.' });
            }
            const { expiresAt } = req.body;
            if (!expiresAt) {
                return res.status(400).json({ message: 'New expiration date is required.' });
            }
            const grant = await db_1.db.grants.findById(req.params.id);
            if (!grant) {
                return res.status(404).json({ message: 'Grant not found.' });
            }
            const newExpiry = new Date(expiresAt);
            if (newExpiry <= new Date()) {
                return res.status(400).json({ message: 'Expiration date must be in the future.' });
            }
            const updated = await db_1.db.grants.updateOne(req.params.id, {
                status: 'active',
                expiresAt: newExpiry
            });
            await (0, crypto_1.logAuditEvent)(grant._id, parentUser.id, 'added_payee', // Denoting config update
            `Renewed grant access for delegate ID ${grant.delegateId} on domain ${grant.domain}. New expiry: ${newExpiry.toLocaleDateString()}`, null);
            io.emit('grant_created', updated);
            const audit = await db_1.db.audit.findLatest();
            if (audit)
                io.emit('audit_event', audit);
            return res.json(updated);
        }
        catch (err) {
            return res.status(500).json({ message: err.message });
        }
    });
    // ----------------------------------------------------
    // ESCALATION ROUTES
    // ----------------------------------------------------
    // Request an escalation
    app.post('/api/escalations', auth_1.authMiddleware, async (req, res) => {
        try {
            const user = req.user;
            if (user.role !== 'delegate') {
                return res.status(403).json({ message: 'Only delegates can request scope escalation.' });
            }
            const { grantId, requestedScope, justification } = req.body;
            if (!grantId || !requestedScope || !justification) {
                return res.status(400).json({ message: 'grantId, requestedScope, and justification are required.' });
            }
            const request = await AgentServices_1.EscalationAgent.requestEscalation(grantId, user.id, requestedScope, justification);
            // Broadcast escalation request
            io.emit('escalation_request', request);
            const audit = await db_1.db.audit.findLatest();
            if (audit)
                io.emit('audit_event', audit);
            return res.status(201).json(request);
        }
        catch (err) {
            return res.status(400).json({ message: err.message });
        }
    });
    // Co-signer approve/deny escalation
    app.post('/api/escalations/:id/approve', auth_1.authMiddleware, async (req, res) => {
        try {
            const user = req.user;
            const { decision, note } = req.body;
            // Allow co_signer or parent to approve escalations for flexibility
            if (user.role !== 'co_signer' && user.role !== 'parent') {
                return res.status(403).json({ message: 'Only co-signers or parents can approve escalations.' });
            }
            if (!decision || !['approved', 'denied'].includes(decision)) {
                return res.status(400).json({ message: 'Decision must be either "approved" or "denied".' });
            }
            const updatedRequest = await AgentServices_1.EscalationAgent.submitApproval(req.params.id, user.id, decision, note || '');
            // Broadcast changes
            io.emit('escalation_approved', updatedRequest);
            const audit = await db_1.db.audit.findLatest();
            if (audit)
                io.emit('audit_event', audit);
            return res.json(updatedRequest);
        }
        catch (err) {
            return res.status(400).json({ message: err.message });
        }
    });
    // Get escalations for family
    app.get('/api/escalations', auth_1.authMiddleware, async (req, res) => {
        try {
            const user = req.user;
            // Find all grants of the family first
            const parentId = await getParentIdForFamily(user.familyId);
            const grants = await db_1.db.grants.find({ parentId });
            const grantIds = grants.map(g => g._id.toString());
            const escalations = await db_1.db.escalations.find({});
            const familyEscalations = escalations.filter(e => e.grantId && grantIds.includes(e.grantId.toString()));
            return res.json(familyEscalations);
        }
        catch (err) {
            return res.status(500).json({ message: err.message });
        }
    });
    // ----------------------------------------------------
    // GUARDIAN ACTION GATES
    // ----------------------------------------------------
    app.post('/api/guardian/execute', auth_1.authMiddleware, async (req, res) => {
        try {
            const delegateUser = req.user;
            if (delegateUser.role !== 'delegate') {
                return res.status(403).json({ message: 'Only delegates can execute oversight actions.' });
            }
            const { type, domain, targetId, amount } = req.body;
            if (!type || !domain) {
                return res.status(400).json({ message: 'Action type and domain are required.' });
            }
            const result = await AgentServices_1.GuardianAgent.checkAndExecute(delegateUser.id, {
                type,
                domain,
                targetId,
                amount: amount ? Number(amount) : undefined,
                familyId: delegateUser.familyId
            });
            // Socket alerts
            if (result.status === 'denied') {
                io.emit('guardian_violation', {
                    delegateId: delegateUser.id,
                    reason: result.reason,
                    actionType: type,
                    domain
                });
            }
            else {
                io.emit('action_executed', {
                    actionType: type,
                    domain,
                    data: result.data
                });
            }
            io.emit('audit_event', result.auditEvent);
            return res.json(result);
        }
        catch (err) {
            return res.status(400).json({ message: err.message });
        }
    });
    // ----------------------------------------------------
    // AUDIT & DATA VIEWS
    // ----------------------------------------------------
    // Get all audit logs
    app.get('/api/audit/logs', auth_1.authMiddleware, async (req, res) => {
        try {
            const logs = await db_1.db.audit.find({});
            return res.json(logs);
        }
        catch (err) {
            return res.status(500).json({ message: err.message });
        }
    });
    // Cryptographic check
    app.get('/api/audit/verify', auth_1.authMiddleware, async (req, res) => {
        try {
            const verification = await (0, crypto_1.verifyAuditChain)();
            return res.json(verification);
        }
        catch (err) {
            return res.status(500).json({ message: err.message });
        }
    });
    // PDF Export
    app.get('/api/audit/export/pdf', auth_1.authMiddleware, async (req, res) => {
        try {
            const events = await db_1.db.audit.find({});
            const pdfBuffer = await (0, exports_1.generateAuditPDF)(events);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename=keyring-audit-report.pdf');
            return res.send(pdfBuffer);
        }
        catch (err) {
            return res.status(500).json({ message: err.message });
        }
    });
    // CSV Export
    app.get('/api/audit/export/csv', auth_1.authMiddleware, async (req, res) => {
        try {
            const events = await db_1.db.audit.find({});
            const csvString = (0, exports_1.generateAuditCSV)(events);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=keyring-audit-report.csv');
            return res.send(csvString);
        }
        catch (err) {
            return res.status(500).json({ message: err.message });
        }
    });
    // Get simulated accounts
    app.get('/api/audit/accounts', auth_1.authMiddleware, async (req, res) => {
        try {
            const user = req.user;
            const accounts = await db_1.db.accounts.find({ familyId: user.familyId });
            return res.json(accounts);
        }
        catch (err) {
            return res.status(500).json({ message: err.message });
        }
    });
    // Get simulated bills
    app.get('/api/audit/bills', auth_1.authMiddleware, async (req, res) => {
        try {
            const user = req.user;
            const bills = await db_1.db.bills.find({ familyId: user.familyId });
            return res.json(bills);
        }
        catch (err) {
            return res.status(500).json({ message: err.message });
        }
    });
    // Get list of family users (delegates, co-signers, etc.)
    app.get('/api/auth/family', auth_1.authMiddleware, async (req, res) => {
        try {
            const user = req.user;
            const users = await db_1.db.users.find({ familyId: user.familyId });
            // Exclude passwords
            const filtered = users.map(u => ({ id: u._id, name: u.name, email: u.email, role: u.role }));
            return res.json(filtered);
        }
        catch (err) {
            return res.status(500).json({ message: err.message });
        }
    });
}
// Helper to find the parent ID for a family (since grants map to parentId)
async function getParentIdForFamily(familyId) {
    const parent = await db_1.db.users.findOne({ familyId, role: 'parent' });
    return parent ? parent._id : 'demo-parent-id';
}

import { Express, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../models/db';
import { authMiddleware, AuthenticatedRequest, JWT_SECRET } from '../middleware/auth';
import { IntakeAgent, GrantAgent, EscalationAgent, GuardianAgent } from '../services/AgentServices';
import { verifyAuditChain, logAuditEvent } from '../utils/crypto';
import { generateAuditPDF, generateAuditCSV } from '../utils/exports';

export function setupRoutes(app: Express, io: any) {

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
      const existing = await db.users.findOne({ email });
      if (existing) {
        return res.status(400).json({ message: 'User with this email already exists.' });
      }

      const passwordHash = bcrypt.hashSync(password, 10);
      const user = await db.users.create({
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
    } catch (err: any) {
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

      const user = await db.users.findOne({ email });
      if (!user || !user.password) {
        return res.status(401).json({ message: 'Invalid credentials.' });
      }

      const isMatch = bcrypt.compareSync(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid credentials.' });
      }

      const token = jwt.sign(
        { id: user._id, email: user.email, role: user.role, familyId: user.familyId },
        JWT_SECRET,
        { expiresIn: '1d' }
      );

      return res.json({
        token,
        user: { id: user._id, name: user.name, email: user.email, role: user.role, familyId: user.familyId }
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // Setup/Seed Demo Environment
  app.post('/api/auth/setup-demo', async (req, res) => {
    try {
      const familyId = 'demo-family-123';

      // Check if demo users already seeded to prevent duplicate key errors
      const demoUsers = await db.users.find({ familyId });
      if (demoUsers.length > 0) {
        return res.json({ message: 'Demo environment already set up.' });
      }

      const passHash = bcrypt.hashSync('password123', 10);

      // Create Parent Jo, Delegate Priya (Primary), Sam (Secondary), Sarah (Skeptical Sibling), Mr. Henderson (Advisor)
      const users = await IntakeAgent.setupFamily(familyId, {
        name: 'Jo (Parent)',
        email: 'jo@example.com',
        passwordHash: passHash
      }, [
        { name: 'Priya (Primary Delegate)', email: 'priya@example.com', passwordHash: passHash, role: 'delegate' },
        { name: 'Sam (Co-signer Sibling)', email: 'sam@example.com', passwordHash: passHash, role: 'co_signer' },
        { name: 'Sarah (Co-signer Sibling)', email: 'sarah@example.com', passwordHash: passHash, role: 'co_signer' },
        { name: 'Mr. Henderson (Family Advisor)', email: 'henderson@example.com', passwordHash: passHash, role: 'advisor' }
      ]);

      return res.json({
        message: 'Demo environment initialized successfully. Seeded users (password: password123)',
        users: users.map(u => ({ id: u._id, name: u.name, email: u.email, role: u.role, familyId: u.familyId }))
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // Custom Family Setup Onboarding API
  app.post('/api/auth/custom-setup', async (req, res) => {
    try {
      const { familyName, parent, members, familyQuorum } = req.body;
      if (!familyName || !parent || !parent.name || !parent.email || !parent.password) {
        return res.status(400).json({ message: 'Family Name, Parent Name, Email and Password are required.' });
      }

      // Check if user email already exists
      const existing = await db.users.findOne({ email: parent.email });
      if (existing) {
        return res.status(400).json({ message: `Parent email ${parent.email} is already in use.` });
      }

      // Clear any existing database entries for a clean setup
      await db.reset();

      const familyId = `family-${Math.random().toString(36).substring(2, 9)}`;
      const parentHash = bcrypt.hashSync(parent.password, 10);
      const defaultMemberHash = bcrypt.hashSync('password123', 10); // Default password for other members in sandbox

      const parentData = {
        name: parent.name,
        email: parent.email,
        passwordHash: parentHash,
        familyQuorum: Number(familyQuorum) || 1
      };

      const delegates = (members || []).map((m: any) => ({
        name: m.name,
        email: m.email,
        passwordHash: defaultMemberHash,
        role: m.role || 'delegate'
      }));

      const users = await IntakeAgent.setupFamily(familyId, parentData, delegates);

      // Return the created users list and also sign in token for the parent automatically
      const createdParent = users.find(u => u.role === 'parent')!;
      const token = jwt.sign(
        { id: createdParent._id, email: createdParent.email, role: createdParent.role, familyId: createdParent.familyId },
        JWT_SECRET,
        { expiresIn: '1d' }
      );

      return res.status(201).json({
        message: 'Family workspace configured successfully',
        token,
        user: { id: createdParent._id, name: createdParent.name, email: createdParent.email, role: createdParent.role, familyId: createdParent.familyId },
        users: users.map(u => ({ id: u._id, name: u.name, email: u.email, role: u.role, familyId: u.familyId }))
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // Reset database endpoint
  app.post('/api/auth/reset-db', async (req, res) => {
    try {
      await db.reset();
      return res.json({ success: true, message: 'Database reset successfully' });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ----------------------------------------------------
  // GRANT ROUTES
  // ----------------------------------------------------

  // Create a new grant (only parent can create)
  app.post('/api/grants', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const { delegateId, scope, domain, reason, startAt, expiresAt, coSigners, transactionCap, monthlyCap } = req.body;
      const parentUser = req.user!;

      if (parentUser.role !== 'parent') {
        return res.status(403).json({ message: 'Only parents can grant account delegations.' });
      }

      const newGrant = await GrantAgent.createGrant({
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
      const audit = await db.audit.findLatest();
      if (audit) io.emit('audit_event', audit);

      return res.status(201).json(newGrant);
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  });

  // List all grants for the user's family
  app.get('/api/grants', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      let query: any = {};

      if (user.role === 'delegate') {
        query.delegateId = user.id;
      } else {
        query.parentId = await getParentIdForFamily(user.familyId);
      }

      const grants = await db.grants.find(query);
      return res.json(grants);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // Revoke a grant (only parent can revoke)
  app.delete('/api/grants/:id', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const parentUser = req.user!;
      if (parentUser.role !== 'parent') {
        return res.status(403).json({ message: 'Only parents can revoke delegation grants.' });
      }

      const revokedGrant = await GrantAgent.revokeGrant(req.params.id, parentUser.id);

      io.emit('grant_revoked', revokedGrant);
      const audit = await db.audit.findLatest();
      if (audit) io.emit('audit_event', audit);

      return res.json(revokedGrant);
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  });

  // Renew an expired/revoked grant (only parent)
  app.post('/api/grants/:id/renew', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const parentUser = req.user!;
      if (parentUser.role !== 'parent') {
        return res.status(403).json({ message: 'Only parents can renew delegation grants.' });
      }

      const { expiresAt } = req.body;
      if (!expiresAt) {
        return res.status(400).json({ message: 'New expiration date is required.' });
      }

      const grant = await db.grants.findById(req.params.id);
      if (!grant) {
        return res.status(404).json({ message: 'Grant not found.' });
      }

      const newExpiry = new Date(expiresAt);
      if (newExpiry <= new Date()) {
        return res.status(400).json({ message: 'Expiration date must be in the future.' });
      }

      const updated = await db.grants.updateOne(req.params.id, {
        status: 'active',
        expiresAt: newExpiry
      });

      await logAuditEvent(
        grant._id,
        parentUser.id,
        'added_payee', // Denoting config update
        `Renewed grant access for delegate ID ${grant.delegateId} on domain ${grant.domain}. New expiry: ${newExpiry.toLocaleDateString()}`,
        null
      );

      io.emit('grant_created', updated);
      const audit = await db.audit.findLatest();
      if (audit) io.emit('audit_event', audit);

      return res.json(updated);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ----------------------------------------------------
  // ESCALATION ROUTES
  // ----------------------------------------------------

  // Request an escalation
  app.post('/api/escalations', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      if (user.role !== 'delegate') {
        return res.status(403).json({ message: 'Only delegates can request scope escalation.' });
      }

      const { grantId, requestedScope, justification } = req.body;
      if (!grantId || !requestedScope || !justification) {
        return res.status(400).json({ message: 'grantId, requestedScope, and justification are required.' });
      }

      const request = await EscalationAgent.requestEscalation(
        grantId,
        user.id,
        requestedScope,
        justification
      );

      // Broadcast escalation request
      io.emit('escalation_request', request);
      const audit = await db.audit.findLatest();
      if (audit) io.emit('audit_event', audit);

      return res.status(201).json(request);
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  });

  // Co-signer approve/deny escalation
  app.post('/api/escalations/:id/approve', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const { decision, note } = req.body;

      // Allow co_signer or parent to approve escalations for flexibility
      if (user.role !== 'co_signer' && user.role !== 'parent') {
        return res.status(403).json({ message: 'Only co-signers or parents can approve escalations.' });
      }

      if (!decision || !['approved', 'denied'].includes(decision)) {
        return res.status(400).json({ message: 'Decision must be either "approved" or "denied".' });
      }

      const updatedRequest = await EscalationAgent.submitApproval(
        req.params.id,
        user.id,
        decision,
        note || ''
      );

      // Broadcast changes
      io.emit('escalation_approved', updatedRequest);
      const audit = await db.audit.findLatest();
      if (audit) io.emit('audit_event', audit);

      return res.json(updatedRequest);
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  });

  // Get escalations for family
  app.get('/api/escalations', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      // Find all grants of the family first
      const parentId = await getParentIdForFamily(user.familyId);
      const grants = await db.grants.find({ parentId });
      const grantIds = grants.map(g => g._id.toString());

      const escalations = await db.escalations.find({});
      const familyEscalations = escalations.filter(e => e.grantId && grantIds.includes(e.grantId.toString()));

      return res.json(familyEscalations);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ----------------------------------------------------
  // GUARDIAN ACTION GATES
  // ----------------------------------------------------

  app.post('/api/guardian/execute', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const actorUser = req.user!;
      if (actorUser.role !== 'delegate' && actorUser.role !== 'parent' && actorUser.role !== 'co_signer') {
        return res.status(403).json({ message: 'Only delegates, parents, or co-signers can execute actions.' });
      }

      const { type, domain, targetId, amount, reason } = req.body;
      if (!type || !domain) {
        return res.status(400).json({ message: 'Action type and domain are required.' });
      }

      const result = await GuardianAgent.checkAndExecute(actorUser.id, {
        type,
        domain,
        targetId,
        amount: amount ? Number(amount) : undefined,
        familyId: actorUser.familyId,
        reason: reason || undefined
      });

      // Socket alerts
      if (result.status === 'denied') {
        io.emit('guardian_violation', {
          delegateId: actorUser.id,
          reason: result.reason,
          actionType: type,
          domain
        });
      } else {
        io.emit('action_executed', {
          actionType: type,
          domain,
          data: result.data
        });
      }

      io.emit('audit_event', result.auditEvent);

      return res.json(result);
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  });

  // ----------------------------------------------------
  // AUDIT & DATA VIEWS
  // ----------------------------------------------------

  // Get all audit logs
  app.get('/api/audit/logs', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const logs = await db.audit.find({});
      return res.json(logs);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // Cryptographic check
  app.get('/api/audit/verify', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const verification = await verifyAuditChain();
      return res.json(verification);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // PDF Export
  app.get('/api/audit/export/pdf', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const events = await db.audit.find({});
      const pdfBuffer = await generateAuditPDF(events);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=keyring-audit-report.pdf');
      return res.send(pdfBuffer);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // CSV Export
  app.get('/api/audit/export/csv', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const events = await db.audit.find({});
      const csvString = generateAuditCSV(events);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=keyring-audit-report.csv');
      return res.send(csvString);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // Get simulated accounts
  app.get('/api/audit/accounts', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      let accounts = await db.accounts.find({ familyId: user.familyId });

      if (user.role === 'delegate') {
        const now = new Date();
        const activeGrants = await db.grants.find({
          delegateId: user.id,
          status: 'active'
        });
        const allowedDomains = activeGrants
          .filter(g => new Date(g.startAt) <= now && new Date(g.expiresAt) >= now)
          .map(g => g.domain);
        accounts = accounts.filter(acc => allowedDomains.includes(acc.domain));
      }

      return res.json(accounts);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // Get simulated bills
  app.get('/api/audit/bills', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      let bills = await db.bills.find({ familyId: user.familyId });

      if (user.role === 'delegate') {
        const now = new Date();
        const activeGrants = await db.grants.find({
          delegateId: user.id,
          status: 'active'
        });
        const allowedDomains = activeGrants
          .filter(g => new Date(g.startAt) <= now && new Date(g.expiresAt) >= now)
          .map(g => g.domain);
        bills = bills.filter(bill => allowedDomains.includes(bill.domain));
      }

      return res.json(bills);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // Get list of family users (delegates, co-signers, etc.)
  app.get('/api/auth/family', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const users = await db.users.find({ familyId: user.familyId });
      // Exclude passwords
      const filtered = users.map(u => ({ id: u._id, name: u.name, email: u.email, role: u.role }));
      return res.json(filtered);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });
}

// Helper to find the parent ID for a family (since grants map to parentId)
async function getParentIdForFamily(familyId: string): Promise<string> {
  const parent = await db.users.findOne({ familyId, role: 'parent' });
  return parent ? parent._id : 'demo-parent-id';
}

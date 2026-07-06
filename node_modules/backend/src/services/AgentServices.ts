import { db } from '../models/db';
import {
  IUser,
  IGrant,
  IEscalationRequest,
  IAuditEvent,
  ISimulatedAccount,
  ISimulatedBill,
  GrantScope,
  GrantDomain,
  AuditActionType
} from '../models/types';
import { logAuditEvent } from '../utils/crypto';

// ----------------------------------------------------
// 1. INTAKE AGENT SERVICE
// ----------------------------------------------------
export const IntakeAgent = {
  /**
   * Registers a new family group by creating a set of default users.
   */
  async setupFamily(
    familyId: string,
    parentData: { name: string; email: string; passwordHash: string; familyQuorum?: number },
    delegates: Array<{ name: string; email: string; passwordHash: string; role: 'delegate' | 'co_signer' | 'sibling' | 'advisor' }>
  ): Promise<IUser[]> {
    const users: IUser[] = [];

    // Create parent
    const parent = await db.users.create({
      name: parentData.name,
      email: parentData.email,
      password: parentData.passwordHash,
      role: 'parent',
      familyId,
      familyQuorum: parentData.familyQuorum || 1
    });
    users.push(parent);

    // Create delegates/siblings/co-signers
    for (const d of delegates) {
      const user = await db.users.create({
        name: d.name,
        email: d.email,
        password: d.passwordHash,
        role: d.role,
        familyId
      });
      users.push(user);
    }

    // Seed simulated bank accounts and bills for the family
    await this.seedSimulatedAccounts(familyId);

    // Log the family creation in the global audit trail
    await logAuditEvent(
      null,
      parent._id,
      'added_payee', // using generic action for demo setup
      `Family Group ${familyId} onboarding complete`,
      null
    );

    return users;
  },

  async seedSimulatedAccounts(familyId: string) {
    // Financial
    await db.accounts.create({
      familyId,
      institution: 'Chase Bank',
      accountName: 'Checking Account',
      accountNumber: '•••• 4829',
      balance: 4250.75,
      domain: 'financial'
    });
    await db.accounts.create({
      familyId,
      institution: 'Fidelity',
      accountName: 'Retirement Savings',
      accountNumber: '•••• 9102',
      balance: 148200.50,
      domain: 'financial'
    });

    // Medical
    await db.accounts.create({
      familyId,
      institution: 'Blue Cross Blue Shield',
      accountName: 'HSA Account',
      accountNumber: '•••• 1122',
      balance: 2350.00,
      domain: 'medical'
    });

    // Financial-domain bills (payable with a 'financial' grant)
    await db.bills.create({
      familyId,
      payee: 'Chase Bank — Credit Card Payment',
      amount: 280.00,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      domain: 'financial',
      status: 'pending'
    });
    await db.bills.create({
      familyId,
      payee: 'Fidelity — Brokerage Fee',
      amount: 45.00,
      dueDate: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000),
      domain: 'financial',
      status: 'pending'
    });

    // Household-domain bills (payable with a 'household' grant)
    await db.bills.create({
      familyId,
      payee: 'Comcast Cable & Internet',
      amount: 120.50,
      dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      domain: 'household',
      status: 'pending'
    });
    await db.bills.create({
      familyId,
      payee: 'Apex Property Management (Rent)',
      amount: 1450.00,
      dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      domain: 'household',
      status: 'pending'
    });
    await db.bills.create({
      familyId,
      payee: 'Pacific Gas & Electric',
      amount: 85.20,
      dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      domain: 'household',
      status: 'pending'
    });

    // Medical-domain bills
    await db.bills.create({
      familyId,
      payee: 'BlueCross BlueShield — Premium',
      amount: 320.00,
      dueDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      domain: 'medical',
      status: 'pending'
    });
  }
};

// ----------------------------------------------------
// 2. GRANT AGENT SERVICE
// ----------------------------------------------------
export const GrantAgent = {
  /**
   * Creates a new scoped delegation grant.
   */
  async createGrant(grantData: Omit<IGrant, '_id' | 'status'>): Promise<IGrant> {
    // Expiration validation
    const now = new Date();
    if (grantData.expiresAt <= now) {
      throw new Error('Grant expiration date must be in the future.');
    }
    if (grantData.expiresAt.getTime() - grantData.startAt.getTime() <= 0) {
      throw new Error('Grant expiration must be after the start time.');
    }

    const grant = await db.grants.create({
      ...grantData,
      status: 'active' // Sets active immediately for hackathon demo
    });

    // Log the event
    await logAuditEvent(
      grant._id,
      grantData.createdBy,
      'added_payee', // using this to denote configuration/grant creation
      `Created ${grant.scope} grant for delegate on ${grant.domain} domain. Expiry: ${grant.expiresAt.toLocaleDateString()}`,
      null
    );

    return grant;
  },

  /**
   * Instantly revokes a grant.
   */
  async revokeGrant(grantId: string, actorId: string): Promise<IGrant> {
    const grant = await db.grants.findById(grantId);
    if (!grant) {
      throw new Error('Grant not found');
    }

    const updated = await db.grants.updateOne(grantId, { status: 'revoked' });
    if (!updated) {
      throw new Error('Failed to update grant status');
    }

    // Log revocation
    await logAuditEvent(
      grantId,
      actorId,
      'grant_revoked',
      `Revoked grant access for delegate ID ${grant.delegateId} on domain ${grant.domain}`,
      null
    );

    return updated;
  }
};

// ----------------------------------------------------
// 3. ESCALATION AGENT SERVICE
// ----------------------------------------------------
export const EscalationAgent = {
  /**
   * Initiates an escalation request to upgrade the scope of an existing grant.
   */
  async requestEscalation(
    grantId: string,
    requestedBy: string,
    requestedScope: GrantScope,
    justification: string
  ): Promise<IEscalationRequest> {
    const grant = await db.grants.findById(grantId);
    if (!grant) {
      throw new Error('Grant not found');
    }

    // Co-signers are pulled from the grant setup, but limited by familyQuorum setting
    const delegateUser = await db.users.findById(requestedBy);
    const parentUser = delegateUser
      ? await db.users.findOne({ familyId: delegateUser.familyId, role: 'parent' })
      : null;
    const familyQuorum = parentUser?.familyQuorum || 1;
    const approversRequired = grant.coSigners.length > 0
      ? Math.min(familyQuorum, grant.coSigners.length)
      : 1;

    const request = await db.escalations.create({
      grantId,
      requestedBy,
      requestedScope,
      justification,
      approversRequired,
      approvals: [],
      status: 'pending'
    });

    // Mark grant as escalation_pending
    await db.grants.updateOne(grantId, { status: 'escalation_pending' });

    // Log the escalation request
    await logAuditEvent(
      grantId,
      requestedBy,
      'escalation_requested',
      `Escalation requested to ${requestedScope} scope. Justification: "${justification}"`,
      null
    );

    return request;
  },

  /**
   * Registers a co-signer decision on a pending escalation.
   */
  async submitApproval(
    requestId: string,
    userId: string,
    decision: 'approved' | 'denied',
    note: string
  ): Promise<IEscalationRequest> {
    const req = await db.escalations.findById(requestId);
    if (!req) {
      throw new Error('Escalation request not found');
    }
    if (req.status !== 'pending') {
      throw new Error(`Escalation request is already ${req.status}`);
    }

    // Check if user has already voted
    const existingIndex = req.approvals.findIndex(a => a.userId === userId);
    const newApproval = { userId, decision, timestamp: new Date(), note };

    let updatedApprovals = [...req.approvals];
    if (existingIndex > -1) {
      updatedApprovals[existingIndex] = newApproval;
    } else {
      updatedApprovals.push(newApproval);
    }

    // Update request approvals
    let updatedReq = await db.escalations.updateOne(requestId, { approvals: updatedApprovals });
    if (!updatedReq) throw new Error('Failed to update approvals');

    // Evaluate decision
    if (decision === 'denied') {
      // Any denial fails the escalation immediately
      updatedReq = await db.escalations.updateOne(requestId, { status: 'denied' });
      await db.grants.updateOne(req.grantId, { status: 'active' }); // Revert grant status to active
      await logAuditEvent(
        req.grantId,
        userId,
        'action_denied',
        `Escalation request denied by co-signer. Note: "${note}"`,
        null
      );
    } else {
      // Count approvals
      const approvalCount = updatedApprovals.filter(a => a.decision === 'approved').length;
      if (approvalCount >= req.approversRequired) {
        // Threshold met! Upgrade the grant
        updatedReq = await db.escalations.updateOne(requestId, { status: 'approved' });
        const grant = await db.grants.findById(req.grantId);
        if (grant) {
          await db.grants.updateOne(req.grantId, {
            scope: req.requestedScope,
            status: 'active'
          });

          await logAuditEvent(
            req.grantId,
            userId,
            'escalation_approved',
            `Escalation approved. Grant upgraded to ${req.requestedScope} scope.`,
            null
          );
        }
      } else {
        await logAuditEvent(
          req.grantId,
          userId,
          'escalation_requested',
          `Co-signer approved escalation. Approvals: ${approvalCount}/${req.approversRequired}`,
          null
        );
      }
    }

    return (await db.escalations.findById(requestId))!;
  }
};

// ----------------------------------------------------
// 4. EXECUTION AGENT SERVICE (Simulated Bank Interactions)
// ----------------------------------------------------
export const ExecutionAgent = {
  /**
   * Executes the actual account viewing.
   */
  async viewBalance(accountId: string): Promise<ISimulatedAccount> {
    const acc = await db.accounts.findById(accountId);
    if (!acc) throw new Error('Simulated account not found');
    return acc;
  },

  /**
   * Executes bill payment by deducting money from checking and marking bill paid.
   */
  async payBill(billId: string, familyId: string): Promise<{ bill: ISimulatedBill; account: ISimulatedAccount }> {
    const bill = await db.bills.findById(billId);
    if (!bill) throw new Error('Simulated bill not found');
    if (bill.status === 'paid') throw new Error('Bill is already paid');

    // Find checking account to deduct funds from
    const accounts = await db.accounts.find({ familyId, accountName: 'Checking Account' });
    if (accounts.length === 0) throw new Error('Checking account not found to pay bill');

    const checking = accounts[0];
    if (checking.balance < bill.amount) {
      throw new Error(`Insufficient funds in checking account. Balance: $${checking.balance}, Bill: $${bill.amount}`);
    }

    // Deduct and mark paid
    const updatedChecking = await db.accounts.updateOne(checking.id, {
      balance: parseFloat((checking.balance - bill.amount).toFixed(2))
    });
    const updatedBill = await db.bills.updateOne(billId, { status: 'paid' });

    if (!updatedChecking || !updatedBill) {
      throw new Error('Failed to execute payment updates');
    }

    return { bill: updatedBill, account: updatedChecking };
  },

  /**
   * Adds a new payee/bill to the household records.
   */
  async addPayee(familyId: string, payeeName: string, amount: number, domain: GrantDomain): Promise<ISimulatedBill> {
    const bill = await db.bills.create({
      familyId,
      payee: payeeName,
      amount,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 2 weeks out
      domain,
      status: 'pending'
    });
    return bill;
  }
};

// ----------------------------------------------------
// 5. GUARDIAN AGENT SERVICE (Gatekeeper checking policies & limits)
// ----------------------------------------------------
export const GuardianAgent = {
  /**
   * Enforces grant policies on delegate requests and coordinates execution.
   */
  async checkAndExecute(
    delegateId: string,
    action: {
      type: 'view_balance' | 'pay_bill' | 'add_payee';
      domain: GrantDomain;
      targetId?: string; // accountId, billId, or payeeName
      amount?: number;
      familyId: string;
      reason?: string;
    }
  ): Promise<{
    status: 'approved' | 'denied';
    reason?: string;
    data?: any;
    auditEvent: IAuditEvent;
  }> {
    const now = new Date();

    let isAnomaly = false;
    let anomalyReason = '';

    // Check payment threshold anomaly
    if (action.type === 'pay_bill' && action.targetId) {
      const bill = await db.bills.findById(action.targetId);
      if (bill && bill.amount > 1000) {
        isAnomaly = true;
        anomalyReason = `Large transaction amount ($${bill.amount.toFixed(2)}) exceeds standard $1,000 anomaly threshold.`;
      }
    }

    // Check keyword anomalies in delegate reason
    if (action.reason) {
      const suspiciousKeywords = ['override', 'urgent', 'withdraw', 'cash', 'quick', 'immediate', 'bypass'];
      const lowercaseReason = action.reason.toLowerCase();
      const matchedKeyword = suspiciousKeywords.find(keyword => lowercaseReason.includes(keyword));
      if (matchedKeyword) {
        isAnomaly = true;
        anomalyReason = anomalyReason
          ? `${anomalyReason} Also matched suspicious keyword: "${matchedKeyword}".`
          : `Justification matches suspicious keyword: "${matchedKeyword}".`;
      }
    }

    // For pay_bill: look up the bill's actual domain from the database
    // to prevent the client from faking the domain on the request.
    let effectiveDomain: GrantDomain = action.domain;
    if (action.type === 'pay_bill' && action.targetId) {
      const bill = await db.bills.findById(action.targetId);
      if (bill) {
        effectiveDomain = bill.domain as GrantDomain;
      }
    }
    // For view_balance: look up the account's actual domain from the database.
    if (action.type === 'view_balance' && action.targetId) {
      const acc = await db.accounts.findById(action.targetId);
      if (acc) {
        effectiveDomain = acc.domain as GrantDomain;
      }
    }

    // Check if the actor is a parent or co-signer. If so, they have direct owner authority, bypass grant checks!
    const actor = await db.users.findById(delegateId);
    if (actor && (actor.role === 'parent' || actor.role === 'co_signer')) {
      let executionResult: any;
      let actionType: AuditActionType;
      let targetDescription = '';

      try {
        if (action.type === 'view_balance') {
          executionResult = await ExecutionAgent.viewBalance(action.targetId!);
          actionType = 'viewed_balance';
          targetDescription = `${actor.name} viewed balance of ${executionResult.institution} ${executionResult.accountName}`;
        } else if (action.type === 'pay_bill') {
          const res = await ExecutionAgent.payBill(action.targetId!, action.familyId);
          executionResult = res;
          actionType = 'paid_bill';
          targetDescription = `${actor.name} paid bill of $${res.bill.amount} to ${res.bill.payee}`;
        } else { // add_payee
          executionResult = await ExecutionAgent.addPayee(action.familyId, action.targetId!, action.amount!, action.domain);
          actionType = 'added_payee';
          targetDescription = `${actor.name} added payee '${executionResult.payee}' with amount $${executionResult.amount}`;
        }

        if (action.reason) {
          targetDescription += `. Reason: "${action.reason}"`;
        }

        const audit = await logAuditEvent(
          null,
          actor._id,
          actionType,
          targetDescription,
          actionType === 'paid_bill' ? executionResult.bill.amount : (actionType === 'added_payee' ? action.amount : null),
          isAnomaly,
          anomalyReason
        );

        return {
          status: 'approved',
          data: executionResult,
          auditEvent: audit
        };
      } catch (err: any) {
        const audit = await logAuditEvent(
          null,
          actor._id,
          'action_denied',
          `Execution Failed: ${err.message}`,
          null,
          isAnomaly,
          anomalyReason
        );
        return {
          status: 'denied',
          reason: `Execution failed: ${err.message}`,
          auditEvent: audit
        };
      }
    }

    // 1. Locate any active grants for this delegate & the resolved domain
    const grants = await db.grants.find({
      delegateId,
      domain: effectiveDomain,
      status: 'active'
    });

    const activeGrant = grants.find(g => new Date(g.startAt) <= now && new Date(g.expiresAt) >= now);

    if (!activeGrant) {
      const audit = await logAuditEvent(
        null,
        delegateId,
        'action_denied',
        `Access Denied: No active/unexpired grant in the '${effectiveDomain}' domain.` + (action.reason ? ` Reason: "${action.reason}"` : ''),
        action.amount || null,
        isAnomaly,
        anomalyReason
      );
      return { status: 'denied', reason: `No active grant exists for the '${effectiveDomain}' domain. This bill/account belongs to the '${effectiveDomain}' domain — create a matching grant first.`, auditEvent: audit };
    }

    // 2. Map actions to required scope level
    // view_only allows: view_balance
    // pay_bills allows: view_balance, pay_bill
    // full_manage allows: view_balance, pay_bill, add_payee
    const scopePriority = {
      'view_only': 1,
      'pay_bills': 2,
      'full_manage': 3
    };

    const requiredScope: Record<string, GrantScope> = {
      'view_balance': 'view_only',
      'pay_bill': 'pay_bills',
      'add_payee': 'full_manage'
    };

    const grantScopeVal = scopePriority[activeGrant.scope];
    const reqScopeVal = scopePriority[requiredScope[action.type]];

    if (grantScopeVal < reqScopeVal) {
      const audit = await logAuditEvent(
        activeGrant._id,
        delegateId,
        'action_denied',
        `Access Denied: Action '${action.type}' requires '${requiredScope[action.type]}' scope. Delegate has '${activeGrant.scope}' scope.` + (action.reason ? ` Reason: "${action.reason}"` : ''),
        action.amount || null,
        isAnomaly,
        anomalyReason
      );
      return {
        status: 'denied',
        reason: `Your current scope '${activeGrant.scope}' is insufficient to perform '${action.type}'. Required scope: '${requiredScope[action.type]}'.`,
        auditEvent: audit
      };
    }

    // 3. For spending actions (pay_bill), verify transaction and monthly limits
    if (action.type === 'pay_bill') {
      const bill = await db.bills.findById(action.targetId!);
      if (!bill) {
        throw new Error('Simulated bill not found');
      }
      const payAmount = bill.amount;

      // Check single transaction cap
      if (activeGrant.transactionCap > 0 && payAmount > activeGrant.transactionCap) {
        const audit = await logAuditEvent(
          activeGrant._id,
          delegateId,
          'action_denied',
          `Access Denied: Payment of $${payAmount} exceeds transaction limit of $${activeGrant.transactionCap}.` + (action.reason ? ` Reason: "${action.reason}"` : ''),
          payAmount,
          isAnomaly,
          anomalyReason
        );
        return {
          status: 'denied',
          reason: `Transaction amount ($${payAmount}) exceeds the allowed limit per transaction ($${activeGrant.transactionCap}) for this grant.`,
          auditEvent: audit
        };
      }

      // Check monthly accumulative cap
      if (activeGrant.monthlyCap > 0) {
        // Fetch audit logs for this grant
        const allLogs = await db.audit.find({ grantId: activeGrant._id, actionType: 'paid_bill' });
        // Calculate sum of payments in the current calendar month
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthlySpent = allLogs
          .filter(e => new Date(e.timestamp) >= startOfMonth)
          .reduce((sum, e) => sum + (e.amount || 0), 0);

        if (monthlySpent + payAmount > activeGrant.monthlyCap) {
          const audit = await logAuditEvent(
            activeGrant._id,
            delegateId,
            'action_denied',
            `Access Denied: Payment of $${payAmount} would exceed monthly spend limit of $${activeGrant.monthlyCap}. Spent this month: $${monthlySpent}.` + (action.reason ? ` Reason: "${action.reason}"` : ''),
            payAmount,
            isAnomaly,
            anomalyReason
          );
          return {
            status: 'denied',
            reason: `Payment would exceed the monthly cumulative spend limit ($${activeGrant.monthlyCap}). Already spent this month: $${monthlySpent.toFixed(2)}.`,
            auditEvent: audit
          };
        }
      }
    }

    // 4. Policy passes! Execute the action via ExecutionAgent
    let executionResult: any;
    let actionType: AuditActionType;
    let targetDescription = '';

    try {
      if (action.type === 'view_balance') {
        executionResult = await ExecutionAgent.viewBalance(action.targetId!);
        actionType = 'viewed_balance';
        targetDescription = `Viewed balance of ${executionResult.institution} ${executionResult.accountName}`;
      } else if (action.type === 'pay_bill') {
        const res = await ExecutionAgent.payBill(action.targetId!, action.familyId);
        executionResult = res;
        actionType = 'paid_bill';
        targetDescription = `Paid bill of $${res.bill.amount} to ${res.bill.payee}`;
      } else { // add_payee
        executionResult = await ExecutionAgent.addPayee(action.familyId, action.targetId!, action.amount!, action.domain);
        actionType = 'added_payee';
        targetDescription = `Added payee '${executionResult.payee}' with amount $${executionResult.amount}`;
      }

      // Log success event
      if (action.reason) {
        targetDescription += `. Reason: "${action.reason}"`;
      }
      const audit = await logAuditEvent(
        activeGrant._id,
        delegateId,
        actionType,
        targetDescription,
        actionType === 'paid_bill' ? executionResult.bill.amount : (actionType === 'added_payee' ? action.amount : null),
        isAnomaly,
        anomalyReason
      );

      return {
        status: 'approved',
        data: executionResult,
        auditEvent: audit
      };
    } catch (err: any) {
      // Handle execution failures (e.g. insufficient funds in checking)
      const audit = await logAuditEvent(
        activeGrant._id,
        delegateId,
        'action_denied',
        `Execution Failed: ${err.message}`,
        null,
        isAnomaly,
        anomalyReason
      );
      return {
        status: 'denied',
        reason: `Execution failed: ${err.message}`,
        auditEvent: audit
      };
    }
  }
};

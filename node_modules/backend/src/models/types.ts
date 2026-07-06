export interface IUser {
  _id: string;
  name: string;
  email: string;
  password?: string;
  role: 'parent' | 'delegate' | 'co_signer' | 'sibling' | 'advisor';
  familyId: string;
  familyQuorum?: number;
}

export type GrantScope = 'view_only' | 'pay_bills' | 'full_manage';
export type GrantDomain = 'financial' | 'medical' | 'household' | 'insurance';
export type GrantStatus = 'pending' | 'active' | 'expired' | 'revoked' | 'escalation_pending';

export interface IGrant {
  _id: string;
  parentId: string;
  delegateId: string;
  scope: GrantScope;
  domain: GrantDomain;
  reason: string;
  createdBy: string;
  startAt: Date;
  expiresAt: Date;
  status: GrantStatus;
  coSigners: string[]; // List of user IDs who are co-signers for this grant's escalation/approval
  parentAck: boolean;
  transactionCap: number; // e.g. 500
  monthlyCap: number;     // e.g. 2000
}

export interface IApproval {
  userId: string;
  decision: 'approved' | 'denied';
  timestamp: Date;
  note: string;
}

export interface IEscalationRequest {
  _id: string;
  grantId: string;
  requestedBy: string;
  requestedScope: GrantScope;
  justification: string;
  approversRequired: number;
  approvals: IApproval[];
  status: 'pending' | 'approved' | 'denied' | 'expired';
  createdAt: Date;
}

export type AuditActionType =
  | 'viewed_balance'
  | 'paid_bill'
  | 'added_payee'
  | 'escalation_requested'
  | 'escalation_approved'
  | 'grant_revoked'
  | 'grant_expired'
  | 'action_denied';

export interface IAuditEvent {
  _id: string;
  grantId: string | null;
  actorId: string;
  actionType: AuditActionType;
  target: string;
  amount: number | null;
  timestamp: Date;
  prevEventHash: string;
  eventHash: string;
  isAnomaly?: boolean;
  anomalyReason?: string;
}

export interface ISimulatedAccount {
  id: string;
  familyId: string;
  institution: string;
  accountName: string;
  accountNumber: string;
  balance: number;
  domain: GrantDomain;
}

export interface ISimulatedBill {
  id: string;
  familyId: string;
  payee: string;
  amount: number;
  dueDate: Date;
  domain: GrantDomain;
  status: 'pending' | 'paid';
}

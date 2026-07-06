import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import {
  Shield,
  Key,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Download,
  RefreshCw,
  Plus,
  Lock,
  Unlock,
  DollarSign,
  Activity,
  FileSpreadsheet,
  ArrowRight,
  TrendingUp,
  HeartPulse,
  Home,
  Briefcase,
  ChevronRight,
  Database,
  User,
  Users
} from 'lucide-react';

const BACKEND_URL = 'http://localhost:5000';

interface UserInfo {
  id: string;
  name: string;
  email: string;
  role: 'parent' | 'delegate' | 'co_signer' | 'sibling' | 'advisor';
  familyId: string;
}

interface Grant {
  _id: string;
  parentId: string;
  delegateId: string;
  scope: 'view_only' | 'pay_bills' | 'full_manage';
  domain: 'financial' | 'medical' | 'household' | 'insurance';
  reason: string;
  startAt: string;
  expiresAt: string;
  status: 'pending' | 'active' | 'expired' | 'revoked' | 'escalation_pending';
  coSigners: string[];
  transactionCap: number;
  monthlyCap: number;
}

interface EscalationRequest {
  _id: string;
  grantId: string;
  requestedBy: string;
  requestedScope: 'view_only' | 'pay_bills' | 'full_manage';
  justification: string;
  approversRequired: number;
  approvals: Array<{
    userId: string;
    decision: 'approved' | 'denied';
    timestamp: string;
    note: string;
  }>;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  createdAt: string;
}

interface AuditLog {
  _id: string;
  grantId: string | null;
  actorId: string;
  actionType: string;
  target: string;
  amount: number | null;
  timestamp: string;
  prevEventHash: string;
  eventHash: string;
  isAnomaly?: boolean;
  anomalyReason?: string;
}

interface Account {
  id: string;
  institution: string;
  accountName: string;
  accountNumber: string;
  balance: number;
  domain: string;
}

interface Bill {
  id: string;
  payee: string;
  amount: number;
  dueDate: string;
  domain: string;
  status: 'pending' | 'paid';
}

type TabType = 'overview' | 'grants' | 'escalations' | 'audit' | 'sandbox';

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserInfo | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isDemoInitialized, setIsDemoInitialized] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  // Core Data States
  const [grants, setGrants] = useState<Grant[]>([]);
  const [escalations, setEscalations] = useState<EscalationRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [familyMembers, setFamilyMembers] = useState<any[]>([]);

  // UI state variables
  const [chainValid, setChainValid] = useState<boolean | null>(null);
  const [verifyingChain, setVerifyingChain] = useState<boolean>(false);
  const [guardianLog, setGuardianLog] = useState<{
    status: 'approved' | 'denied' | 'idle';
    message: string;
    details?: string;
  }>({ status: 'idle', message: 'Ready. Guardian Agent actively inspecting requests.' });

  // Creation forms states
  const [showCreateGrant, setShowCreateGrant] = useState(false);
  const [newGrantDelegate, setNewGrantDelegate] = useState('');
  const [newGrantDomain, setNewGrantDomain] = useState<'financial' | 'medical' | 'household' | 'insurance'>('financial');
  const [newGrantScope, setNewGrantScope] = useState<'view_only' | 'pay_bills' | 'full_manage'>('view_only');
  const [newGrantReason, setNewGrantReason] = useState('');
  const [newGrantTxCap, setNewGrantTxCap] = useState('500');
  const [newGrantMonthlyCap, setNewGrantMonthlyCap] = useState('2000');
  const [newGrantExpiryMonths, setNewGrantExpiryMonths] = useState('1');

  // Escalation request states
  const [showEscalationModal, setShowEscalationModal] = useState(false);
  const [escalateGrantId, setEscalateGrantId] = useState('');
  const [escalateScope, setEscalateScope] = useState<'pay_bills' | 'full_manage'>('pay_bills');
  const [escalateJustification, setEscalateJustification] = useState('');

  // Approval inputs
  const [approvalNotes, setApprovalNotes] = useState<{ [reqId: string]: string }>({});

  // Custom Onboarding Form State
  const [showOnboardingForm, setShowOnboardingForm] = useState(false);
  const [onboardingFamilyName, setOnboardingFamilyName] = useState('My Family Oversight');
  const [onboardingParentName, setOnboardingParentName] = useState('');
  const [onboardingParentEmail, setOnboardingParentEmail] = useState('');
  const [onboardingParentPassword, setOnboardingParentPassword] = useState('password123');
  const [onboardingQuorum, setOnboardingQuorum] = useState(1);
  const [onboardingMembers, setOnboardingMembers] = useState<Array<{ name: string; email: string; role: 'delegate' | 'co_signer' }>>([
    { name: 'Priya', email: 'priya@example.com', role: 'delegate' },
    { name: 'Sam', email: 'sam@example.com', role: 'co_signer' }
  ]);

  // Action Reason State
  const [reasonModalOpen, setReasonModalOpen] = useState(false);
  const [reasonActionType, setReasonActionType] = useState<'view_balance' | 'pay_bill' | 'add_payee' | null>(null);
  const [reasonTargetId, setReasonTargetId] = useState('');
  const [reasonDomain, setReasonDomain] = useState('');
  const [reasonAmount, setReasonAmount] = useState<number | null>(null);
  const [actionReasonText, setActionReasonText] = useState('');

  // Audit Filter States
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActorFilter, setAuditActorFilter] = useState('all');
  const [auditActionFilter, setAuditActionFilter] = useState('all');

  // New Payee/Expense Form States
  const [newPayeeName, setNewPayeeName] = useState('');
  const [newPayeeAmount, setNewPayeeAmount] = useState('');
  const [newPayeeDomain, setNewPayeeDomain] = useState<string>('household');

  // Socket state connection
  useEffect(() => {
    const socket = io(BACKEND_URL);

    socket.on('connect', () => {
      console.log('[SOCKET] Connected to real-time events');
    });

    socket.on('audit_event', (event: AuditLog) => {
      setAuditLogs(prev => [event, ...prev]);
      if (token) {
        fetchAccounts(token);
        fetchBills(token);
      }
    });

    socket.on('grant_created', () => {
      if (token) fetchGrants(token);
    });

    socket.on('grant_revoked', () => {
      if (token) fetchGrants(token);
    });

    socket.on('escalation_request', (req: EscalationRequest) => {
      setEscalations(prev => {
        const idx = prev.findIndex(e => e._id === req._id);
        if (idx > -1) {
          const updated = [...prev];
          updated[idx] = req;
          return updated;
        }
        return [req, ...prev];
      });
      if (token) fetchGrants(token);
    });

    socket.on('escalation_approved', (req: EscalationRequest) => {
      setEscalations(prev => {
        const idx = prev.findIndex(e => e._id === req._id);
        if (idx > -1) {
          const updated = [...prev];
          updated[idx] = req;
          return updated;
        }
        return prev;
      });
      if (token) fetchGrants(token);
    });

    socket.on('grant_expired', () => {
      if (token) fetchGrants(token);
    });

    socket.on('guardian_violation', (data) => {
      setGuardianLog({
        status: 'denied',
        message: `Guardian Blocked Request`,
        details: data.reason
      });
      try {
        const synth = window.speechSynthesis;
        const utter = new SpeechSynthesisUtterance("Access Denied: Guardian Agent blocked the transaction.");
        utter.rate = 1.0;
        synth.speak(utter);
      } catch (e) {}
    });

    socket.on('action_executed', (data) => {
      setGuardianLog({
        status: 'approved',
        message: `Action Executed Successfully`,
        details: `Passed all active policy and spending limits.`
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [token]);

  // Load user from local storage
  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');

    if (savedToken && savedUser) {
      setToken(savedToken);
      const parsedUser = JSON.parse(savedUser);
      setCurrentUser(parsedUser);
      loadAllData(savedToken);
    } else {
      testBackendSeed();
    }
  }, []);

  // Enforce read-only constraint for advisor role
  useEffect(() => {
    if (currentUser?.role === 'advisor' && activeTab !== 'audit') {
      setActiveTab('audit');
    }
  }, [currentUser, activeTab]);

  const testBackendSeed = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'jo@example.com', password: 'password123' })
      });
      if (res.ok) {
        const data = await res.json();
        setToken(data.token);
        setCurrentUser(data.user);
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        setIsDemoInitialized(true);
        loadAllData(data.token);
      } else {
        setIsLoading(false);
      }
    } catch (e) {
      setIsLoading(false);
    }
  };

  const loadAllData = async (jwtToken: string) => {
    setIsLoading(true);
    try {
      await Promise.all([
        fetchGrants(jwtToken),
        fetchEscalations(jwtToken),
        fetchAuditLogs(jwtToken),
        fetchAccounts(jwtToken),
        fetchBills(jwtToken),
        fetchFamilyMembers(jwtToken)
      ]);
      setIsDemoInitialized(true);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchGrants = async (jwtToken: string) => {
    const res = await fetch(`${BACKEND_URL}/api/grants`, {
      headers: { Authorization: `Bearer ${jwtToken}` }
    });
    if (res.ok) setGrants(await res.json());
  };

  const fetchEscalations = async (jwtToken: string) => {
    const res = await fetch(`${BACKEND_URL}/api/escalations`, {
      headers: { Authorization: `Bearer ${jwtToken}` }
    });
    if (res.ok) setEscalations(await res.json());
  };

  const fetchAuditLogs = async (jwtToken: string) => {
    const res = await fetch(`${BACKEND_URL}/api/audit/logs`, {
      headers: { Authorization: `Bearer ${jwtToken}` }
    });
    if (res.ok) setAuditLogs(await res.json());
  };

  const fetchAccounts = async (jwtToken: string) => {
    const res = await fetch(`${BACKEND_URL}/api/audit/accounts`, {
      headers: { Authorization: `Bearer ${jwtToken}` }
    });
    if (res.ok) setAccounts(await res.json());
  };

  const fetchBills = async (jwtToken: string) => {
    const res = await fetch(`${BACKEND_URL}/api/audit/bills`, {
      headers: { Authorization: `Bearer ${jwtToken}` }
    });
    if (res.ok) setBills(await res.json());
  };

  const handleCustomSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const validMembers = onboardingMembers.filter(m => m.name && m.email);
    if (validMembers.length === 0) {
      alert('Please add at least one delegate or co-signer.');
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/custom-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          familyName: onboardingFamilyName,
          parent: {
            name: onboardingParentName,
            email: onboardingParentEmail,
            password: onboardingParentPassword
          },
          members: validMembers,
          familyQuorum: onboardingQuorum
        })
      });

      const data = await res.json();
      if (res.ok) {
        setToken(data.token);
        setCurrentUser(data.user);
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        setIsDemoInitialized(true);
        setShowOnboardingForm(false);
        await loadAllData(data.token);
      } else {
        alert(data.message || 'Custom setup failed.');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to connect to backend.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetWorkspace = async () => {
    if (!confirm('Are you sure you want to completely reset this family workspace? All data will be lost.')) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/reset-db`, {
        method: 'POST'
      });
      if (res.ok) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setToken(null);
        setCurrentUser(null);
        setIsDemoInitialized(false);
        window.location.reload();
      }
    } catch (e) {
      alert('Failed to reset workspace.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewBalanceClick = (accountId: string, domain: string) => {
    if (currentUser?.role === 'delegate') {
      setReasonActionType('view_balance');
      setReasonTargetId(accountId);
      setReasonDomain(domain);
      setReasonAmount(null);
      setActionReasonText('');
      setReasonModalOpen(true);
    } else {
      handleViewBalance(accountId, domain);
    }
  };

  const handlePayBillClick = (billId: string, domain: string, amount: number) => {
    if (currentUser?.role === 'delegate') {
      setReasonActionType('pay_bill');
      setReasonTargetId(billId);
      setReasonDomain(domain);
      setReasonAmount(amount);
      setActionReasonText('');
      setReasonModalOpen(true);
    } else {
      handlePayBill(billId, domain);
    }
  };

  const handleAddPayeeClick = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPayeeName || !newPayeeAmount) {
      alert('Payee name and amount are required.');
      return;
    }
    const amountNum = Number(newPayeeAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert('Please enter a valid positive number for the amount.');
      return;
    }

    if (currentUser?.role === 'delegate') {
      setReasonActionType('add_payee');
      setReasonTargetId(newPayeeName);
      setReasonDomain(newPayeeDomain);
      setReasonAmount(amountNum);
      setActionReasonText('');
      setReasonModalOpen(true);
    } else {
      handleAddPayee(newPayeeName, newPayeeDomain, amountNum);
    }
  };

  const handleReasonSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !reasonActionType) return;

    setReasonModalOpen(false);
    setGuardianLog({ status: 'idle', message: 'Analyzing request policies...' });

    try {
      const res = await fetch(`${BACKEND_URL}/api/guardian/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          type: reasonActionType,
          domain: reasonDomain,
          targetId: reasonTargetId,
          amount: reasonAmount || undefined,
          reason: actionReasonText
        })
      });
      const data = await res.json();
      if (res.ok && data.status === 'approved') {
        fetchAccounts(token);
        fetchBills(token);
        setGuardianLog({ status: 'approved', message: 'Action executed successfully.' });
      } else {
        const errorMsg = data.reason || data.message || 'Action execution denied.';
        setGuardianLog({ status: 'denied', message: errorMsg });
        alert(`Action Denied: ${errorMsg}`);
      }
    } catch (err) {
      console.error(err);
      setGuardianLog({ status: 'denied', message: 'Failed to connect to security backend.' });
      alert('Network Error: Failed to contact the security server.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setCurrentUser(null);
    setIsDemoInitialized(false);
  };

  const fetchFamilyMembers = async (jwtToken: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/family`, {
        headers: { Authorization: `Bearer ${jwtToken}` }
      });
      if (res.ok) {
        const members = await res.json();
        setFamilyMembers(members);

        if (members.length === 0) {
          console.warn('[KEYRING] Session references an empty database. Resetting.');
          handleLogout();
          return;
        }

        if (currentUser) {
          const userStillExists = members.some((m: any) => m.id === currentUser.id);
          if (!userStillExists) {
            console.warn('[KEYRING] Logged-in user no longer in database. Resetting.');
            handleLogout();
          }
        }
      } else {
        handleLogout();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleInitializeDemo = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/setup-demo`, {
        method: 'POST'
      });
      if (res.ok) {
        const loginRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'jo@example.com', password: 'password123' })
        });
        const loginData = await loginRes.json();
        setToken(loginData.token);
        setCurrentUser(loginData.user);
        localStorage.setItem('token', loginData.token);
        localStorage.setItem('user', JSON.stringify(loginData.user));
        setIsDemoInitialized(true);
        await loadAllData(loginData.token);
      }
    } catch (e) {
      alert('Failed to boot backend. Ensure backend is running.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwitchUser = async (email: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123' })
      });
      const data = await res.json();
      if (res.ok) {
        setToken(data.token);
        setCurrentUser(data.user);
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        await loadAllData(data.token);
      }
    } catch (e) {
      alert('Error switching user');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    if (!newGrantDelegate) {
      alert('Please select a delegate from the dropdown list.');
      return;
    }

    const startAt = new Date();
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + Number(newGrantExpiryMonths));

    const coSigners = familyMembers
      .filter(f => f.role === 'co_signer')
      .map(f => f.id);

    try {
      const res = await fetch(`${BACKEND_URL}/api/grants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          delegateId: newGrantDelegate,
          scope: newGrantScope,
          domain: newGrantDomain,
          reason: newGrantReason,
          startAt: startAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          coSigners,
          transactionCap: Number(newGrantTxCap),
          monthlyCap: Number(newGrantMonthlyCap)
        })
      });

      if (res.ok) {
        setShowCreateGrant(false);
        setNewGrantReason('');
        fetchGrants(token);
      } else {
        const err = await res.json();
        alert(err.message);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleRevokeGrant = async (grantId: string) => {
    if (!token) return;
    if (!confirm('Are you sure you want to revoke this delegation instantly?')) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/grants/${grantId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchGrants(token);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleRenewGrant = async (grantId: string) => {
    if (!token) return;
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 1);

    try {
      const res = await fetch(`${BACKEND_URL}/api/grants/${grantId}/renew`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ expiresAt: expiresAt.toISOString() })
      });
      if (res.ok) {
        fetchGrants(token);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleViewBalance = async (accountId: string, domain: string) => {
    if (!token) return;
    setGuardianLog({ status: 'idle', message: 'Analyzing request policies...' });

    try {
      const res = await fetch(`${BACKEND_URL}/api/guardian/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          type: 'view_balance',
          domain,
          targetId: accountId
        })
      });
      const data = await res.json();
      if (res.ok && data.status === 'approved') {
        fetchAccounts(token);
        setGuardianLog({ status: 'approved', message: 'Balance retrieved successfully.' });
      } else {
        const errorMsg = data.reason || data.message || 'Balance retrieval denied.';
        setGuardianLog({ status: 'denied', message: errorMsg });
        alert(`Balance Retrieval Denied: ${errorMsg}`);
      }
    } catch (e) {
      console.error(e);
      setGuardianLog({ status: 'denied', message: 'Failed to connect to security backend.' });
      alert('Network Error: Failed to contact the security server.');
    }
  };

  const handlePayBill = async (billId: string, domain: string) => {
    if (!token) return;
    setGuardianLog({ status: 'idle', message: 'Inspecting limits and scope...' });

    try {
      const res = await fetch(`${BACKEND_URL}/api/guardian/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          type: 'pay_bill',
          domain,
          targetId: billId
        })
      });
      const data = await res.json();
      if (res.ok && data.status === 'approved') {
        fetchBills(token);
        fetchAccounts(token);
        setGuardianLog({ status: 'approved', message: 'Payment executed successfully.' });
      } else {
        const errorMsg = data.reason || data.message || 'Payment execution denied.';
        setGuardianLog({ status: 'denied', message: errorMsg });
        alert(`Payment Denied: ${errorMsg}`);
      }
    } catch (e) {
      console.error(e);
      setGuardianLog({ status: 'denied', message: 'Failed to connect to security backend.' });
      alert('Network Error: Failed to contact the security server.');
    }
  };

  const handleAddPayee = async (payee: string, domain: string, amount: number) => {
    if (!token) return;
    setGuardianLog({ status: 'idle', message: 'Inspecting limits and scope...' });

    try {
      const res = await fetch(`${BACKEND_URL}/api/guardian/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          type: 'add_payee',
          domain,
          targetId: payee,
          amount
        })
      });
      const data = await res.json();
      if (res.ok && data.status === 'approved') {
        fetchBills(token);
        setGuardianLog({ status: 'approved', message: 'Payee added successfully.' });
        setNewPayeeName('');
        setNewPayeeAmount('');
      } else {
        const errorMsg = data.reason || data.message || 'Action denied.';
        setGuardianLog({ status: 'denied', message: errorMsg });
        alert(`Action Denied: ${errorMsg}`);
      }
    } catch (e) {
      console.error(e);
      setGuardianLog({ status: 'denied', message: 'Failed to connect to security backend.' });
      alert('Network Error: Failed to contact the security server.');
    }
  };

  const handleRequestEscalation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/escalations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          grantId: escalateGrantId,
          requestedScope: escalateScope,
          justification: escalateJustification
        })
      });

      if (res.ok) {
        setShowEscalationModal(false);
        setEscalateJustification('');
        fetchEscalations(token);
        fetchGrants(token);
      } else {
        const err = await res.json();
        alert(err.message);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleApproveEscalation = async (reqId: string, decision: 'approved' | 'denied') => {
    if (!token) return;
    const note = approvalNotes[reqId] || '';

    try {
      const res = await fetch(`${BACKEND_URL}/api/escalations/${reqId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ decision, note })
      });
      if (res.ok) {
        fetchEscalations(token);
        fetchGrants(token);
        setApprovalNotes(prev => ({ ...prev, [reqId]: '' }));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleVerifyChain = async () => {
    if (!token) return;
    setVerifyingChain(true);
    setChainValid(null);

    setTimeout(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/audit/verify`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        setChainValid(data.valid);
      } catch (e) {
        setChainValid(false);
      } finally {
        setVerifyingChain(false);
      }
    }, 800);
  };

  const handleDownloadPDF = () => {
    if (!token) return;
    window.open(`${BACKEND_URL}/api/audit/export/pdf?authorization=Bearer ${token}`, '_blank');
  };

  const handleDownloadCSV = () => {
    if (!token) return;
    window.open(`${BACKEND_URL}/api/audit/export/csv?authorization=Bearer ${token}`, '_blank');
  };

  // ----------------------------------------------------
  // MINIMAL RENDER HELPERS
  // ----------------------------------------------------

  const getDomainIcon = (domain: string) => {
    switch (domain) {
      case 'financial':
        return <DollarSign className="w-4 h-4 text-zinc-400" />;
      case 'medical':
        return <HeartPulse className="w-4 h-4 text-zinc-400" />;
      case 'household':
        return <Home className="w-4 h-4 text-zinc-400" />;
      case 'insurance':
        return <Briefcase className="w-4 h-4 text-zinc-400" />;
      default:
        return <Shield className="w-4 h-4 text-zinc-400" />;
    }
  };

  const getScopeBadge = (scope: string) => {
    switch (scope) {
      case 'view_only':
        return <span className="px-2 py-0.5 text-[10px] font-medium border border-zinc-800 bg-zinc-900 text-zinc-300 rounded">View Only</span>;
      case 'pay_bills':
        return <span className="px-2 py-0.5 text-[10px] font-medium border border-blue-900/30 bg-blue-950/20 text-blue-400 rounded">Pay Bills</span>;
      case 'full_manage':
        return <span className="px-2 py-0.5 text-[10px] font-medium border border-indigo-900/30 bg-indigo-950/20 text-indigo-400 rounded">Full Control</span>;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="px-2 py-0.5 text-[10px] font-medium border border-emerald-900/30 bg-emerald-950/20 text-emerald-400 rounded">Active</span>;
      case 'revoked':
        return <span className="px-2 py-0.5 text-[10px] font-medium border border-red-900/30 bg-red-950/20 text-red-400 rounded">Revoked</span>;
      case 'expired':
        return <span className="px-2 py-0.5 text-[10px] font-medium border border-zinc-800 bg-zinc-900 text-zinc-500 rounded">Expired</span>;
      case 'escalation_pending':
        return <span className="px-2 py-0.5 text-[10px] font-medium border border-amber-900/30 bg-amber-950/20 text-amber-400 rounded">Escalating</span>;
      default:
        return <span className="px-2 py-0.5 text-[10px] font-medium border border-zinc-800 bg-zinc-900 text-zinc-400 rounded">{status}</span>;
    }
  };

  const getMemberName = (id: string) => {
    const mem = familyMembers.find(f => f.id === id);
    return mem ? mem.name : id === 'SYSTEM' ? 'System Chain Guard' : 'Unknown';
  };

  if (!isDemoInitialized) {
    if (showOnboardingForm) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen px-4 bg-zinc-950 py-12">
          <div className="w-full max-w-lg border border-zinc-800 bg-zinc-900/40 p-6 md:p-8 rounded-2xl backdrop-blur-md">
            <div className="flex items-center gap-3 mb-6 border-b border-zinc-800 pb-4">
              <Shield className="w-6 h-6 text-zinc-100" />
              <h2 className="text-lg font-bold text-zinc-100 font-heading">Configure Family Oversight</h2>
            </div>

            <form onSubmit={handleCustomSetup} className="space-y-4">
              {/* Section 1: Family Info */}
              <div className="space-y-3">
                <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">1. Family Details</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Family name</label>
                    <input
                      type="text"
                      value={onboardingFamilyName}
                      onChange={e => setOnboardingFamilyName(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Approval Quorum (Required Votes)</label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={onboardingQuorum}
                      onChange={e => setOnboardingQuorum(Number(e.target.value))}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Parent details */}
              <div className="space-y-3 pt-2">
                <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">2. Primary Account Owner (Parent)</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1">
                    <label className="block text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Parent Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Jo"
                      value={onboardingParentName}
                      onChange={e => setOnboardingParentName(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300"
                      required
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Email</label>
                    <input
                      type="email"
                      placeholder="jo@example.com"
                      value={onboardingParentEmail}
                      onChange={e => setOnboardingParentEmail(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300"
                      required
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Password</label>
                    <input
                      type="password"
                      value={onboardingParentPassword}
                      onChange={e => setOnboardingParentPassword(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Section 3: Delegates & Co-signers */}
              <div className="space-y-3 pt-2">
                <div className="flex justify-between items-center">
                  <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">3. Family Members & Roles</h3>
                  <button
                    type="button"
                    onClick={() => setOnboardingMembers([...onboardingMembers, { name: '', email: '', role: 'delegate' }])}
                    className="text-[10px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1 cursor-pointer font-bold"
                  >
                    <Plus className="w-3 h-3" /> Add Member
                  </button>
                </div>

                <div className="max-h-48 overflow-y-auto space-y-2.5 pr-1">
                  {onboardingMembers.map((m, idx) => (
                    <div key={idx} className="flex gap-2.5 items-end bg-zinc-950/40 p-2.5 border border-zinc-800 rounded-lg">
                      <div className="flex-1">
                        <label className="block text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Name</label>
                        <input
                          type="text"
                          placeholder="e.g. Priya"
                          value={m.name}
                          onChange={e => {
                            const newM = [...onboardingMembers];
                            newM[idx].name = e.target.value;
                            setOnboardingMembers(newM);
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded p-1.5 text-xs text-zinc-300"
                          required
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Email</label>
                        <input
                          type="email"
                          placeholder="priya@example.com"
                          value={m.email}
                          onChange={e => {
                            const newM = [...onboardingMembers];
                            newM[idx].email = e.target.value;
                            setOnboardingMembers(newM);
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded p-1.5 text-xs text-zinc-300"
                          required
                        />
                      </div>
                      <div className="w-28">
                        <label className="block text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Role</label>
                        <select
                          value={m.role}
                          onChange={e => {
                            const newM = [...onboardingMembers];
                            newM[idx].role = e.target.value as any;
                            setOnboardingMembers(newM);
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded p-1.5 text-xs text-zinc-300"
                        >
                          <option value="delegate">Delegate</option>
                          <option value="co_signer">Co-signer</option>
                        </select>
                      </div>
                      {onboardingMembers.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setOnboardingMembers(onboardingMembers.filter((_, i) => i !== idx))}
                          className="text-red-500 hover:text-red-400 p-1 text-xs cursor-pointer"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowOnboardingForm(false)}
                  className="flex-1 py-2.5 px-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 font-medium rounded-lg text-xs cursor-pointer transition-clean"
                >
                  Back to Quick Launch
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 py-2.5 px-4 text-zinc-950 font-bold bg-zinc-50 hover:bg-zinc-200 disabled:opacity-50 rounded-lg text-xs cursor-pointer transition-clean flex items-center justify-center gap-1.5"
                >
                  {isLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Initialize Family'}
                </button>
              </div>
            </form>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4 bg-zinc-950">
        <div className="w-full max-w-md border border-zinc-800 bg-zinc-900/50 p-8 rounded-2xl text-center space-y-6">
          <div className="inline-flex p-3.5 rounded-xl bg-zinc-900 border border-zinc-800">
            <Shield className="w-10 h-10 text-zinc-100" />
          </div>
          <div>
            <h1 className="text-2xl font-bold font-heading text-zinc-100 mb-1">KeyRing</h1>
            <p className="text-zinc-400 text-xs max-w-sm mx-auto leading-relaxed">
              Scoped, Time-Boxed Delegation layer for aging-parent financial & medical account oversight.
            </p>
          </div>

          <div className="space-y-2.5 pt-2">
            <button
              onClick={handleInitializeDemo}
              disabled={isLoading}
              className="w-full py-3 px-4 text-zinc-950 font-semibold rounded-lg bg-zinc-50 hover:bg-zinc-200 transition-clean flex items-center justify-center gap-2 cursor-pointer text-xs"
            >
              {isLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <span>Quick Launch Demo Workspace</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <button
              onClick={() => {
                setOnboardingParentName('');
                setOnboardingParentEmail('');
                setShowOnboardingForm(true);
              }}
              disabled={isLoading}
              className="w-full py-3 px-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 font-semibold rounded-lg transition-clean flex items-center justify-center gap-2 cursor-pointer text-xs"
            >
              <span>Configure Custom Family Group</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
  const totalMonthlySpend = auditLogs
    .filter(log => {
      if (log.actionType !== 'paid_bill' || !log.amount) return false;
      const logDate = new Date(log.timestamp);
      const now = new Date();
      return logDate.getMonth() === now.getMonth() && logDate.getFullYear() === now.getFullYear();
    })
    .reduce((sum, log) => sum + (log.amount || 0), 0);

  const expiringGrants = grants.filter(g => {
    if (g.status !== 'active') return false;
    const daysLeft = (new Date(g.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return daysLeft >= 0 && daysLeft <= 7;
  });

  const urgentExpiringGrants = grants.filter(g => {
    if (g.status !== 'active') return false;
    const hoursLeft = (new Date(g.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60);
    return hoursLeft >= 0 && hoursLeft <= 48;
  });

  const deniedAttempts = auditLogs.filter(log => log.actionType === 'action_denied');
  const flaggedAnomalies = auditLogs.filter(log => (log as any).isAnomaly);

  return (
    <div className="min-h-screen flex bg-zinc-950 text-zinc-50 font-sans">
      
      {/* 1. LEFT SIDEBAR */}
      <aside className="w-64 border-r border-zinc-800 bg-zinc-950 flex flex-col justify-between flex-shrink-0">
        <div className="flex flex-col">
          {/* Logo / Header */}
          <div className="h-14 border-b border-zinc-800 px-6 flex items-center gap-2.5">
            <Shield className="w-5 h-5 text-zinc-100" />
            <span className="font-bold text-sm tracking-tight font-heading text-zinc-100">KeyRing</span>
          </div>

          {/* Navigation Link List */}
          <nav className="p-3 space-y-1">
            {[
              { id: 'overview', label: 'Overview', icon: <Activity className="w-4 h-4" /> },
              { id: 'grants', label: 'Delegations', icon: <Key className="w-4 h-4" /> },
              { id: 'escalations', label: 'Approvals Queue', icon: <Users className="w-4 h-4" /> },
              { id: 'audit', label: 'Audit Trail', icon: <FileText className="w-4 h-4" /> },
              { id: 'sandbox', label: 'Sandbox Bank', icon: <DollarSign className="w-4 h-4" /> }
            ]
              .filter(item => currentUser?.role !== 'advisor' || item.id === 'audit')
              .map(item => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as TabType)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-xs font-medium transition-clean cursor-pointer ${
                  activeTab === item.id
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* User Workspace Profile Switcher at bottom */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/30">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-200">
              {currentUser?.name[0]}
            </div>
            <div className="overflow-hidden">
              <h4 className="text-xs font-semibold text-zinc-200 truncate">{currentUser?.name}</h4>
              <p className="text-[10px] text-zinc-500 capitalize truncate">{currentUser?.role}</p>
            </div>
          </div>

          <div className="space-y-1 border-t border-zinc-800/80 pt-2.5">
            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-1.5">Switch Identity:</span>
            {[
              { email: 'jo@example.com', name: 'Jo (Parent)' },
              { email: 'priya@example.com', name: 'Priya (Delegate)' },
              { email: 'sam@example.com', name: 'Sam (Co-signer)' },
              { email: 'sarah@example.com', name: 'Sarah (Co-signer)' },
              { email: 'henderson@example.com', name: 'Mr. Henderson (Advisor)' }
            ].map(u => (
              <button
                key={u.email}
                onClick={() => handleSwitchUser(u.email)}
                disabled={currentUser?.email === u.email}
                className={`w-full text-left px-2 py-1 rounded text-[11px] font-medium transition-clean cursor-pointer block ${
                  currentUser?.email === u.email
                    ? 'text-zinc-500 font-bold bg-zinc-900/50'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                {u.name}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* 2. MAIN CONTAINER */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* TOP BAR HEADER */}
        <header className="h-14 border-b border-zinc-800 px-6 flex items-center justify-between flex-shrink-0 bg-zinc-950">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span className="font-semibold text-zinc-300">Oversight Workspace</span>
            <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
            <span className="capitalize">{activeTab}</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-[10px] text-zinc-400 font-mono">
              <Database className="w-3 h-3 text-zinc-500" />
              <span>In-Memory sandbox DB</span>
            </div>
            <button
              onClick={handleResetWorkspace}
              className="px-2.5 py-1 bg-red-950/20 hover:bg-red-900/30 border border-red-500/20 text-red-400 hover:text-red-300 rounded-lg text-[10px] font-semibold cursor-pointer transition-clean flex items-center gap-1"
            >
              Reset Workspace
            </button>
          </div>
        </header>

        {/* MAIN GRID BODY */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* CONTENT COMPONENT AREA */}
          <main className="flex-1 overflow-y-auto p-6 md:p-8 max-w-4xl w-full mx-auto space-y-6">
            
            {/* Urgent Expiry Banner (Parent/Co-signer Only) */}
            {currentUser?.role !== 'delegate' && urgentExpiringGrants.map(ug => {
              const hoursLeft = Math.max(1, Math.round((new Date(ug.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60)));
              return (
                <div key={ug._id} className="p-4 bg-amber-950/20 border border-amber-500/30 rounded-xl flex items-center justify-between gap-4 text-xs text-amber-400 font-sans">
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 animate-pulse" />
                    <div>
                      <h4 className="font-bold text-amber-200">Upcoming Delegation Expiration</h4>
                      <p className="text-zinc-400 mt-0.5">
                        {getMemberName(ug.delegateId)}'s delegation grant for domain <strong>{ug.domain}</strong> expires in {hoursLeft} hours.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRenewGrant(ug._id)}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-450 text-zinc-950 font-bold rounded-lg transition-clean cursor-pointer whitespace-nowrap"
                  >
                    Renew for 30 Days
                  </button>
                </div>
              );
            })}
            
            {/* TAB OVERVIEW */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-semibold text-zinc-100 tracking-tight">Oversight Dashboard</h2>
                  <p className="text-xs text-zinc-400 mt-1">Review active oversight boundaries and verify cryptographic audit trails.</p>
                </div>

                {/* Quick Stats Grid */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="border border-zinc-800 bg-zinc-900/20 p-4 rounded-xl">
                    <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block">Active Grants</span>
                    <span className="text-xl font-bold text-zinc-100 mt-1.5 block">{grants.filter(g => g.status === 'active').length}</span>
                  </div>
                  <div className="border border-zinc-800 bg-zinc-900/20 p-4 rounded-xl">
                    <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block">Pending Votes</span>
                    <span className="text-xl font-bold text-zinc-100 mt-1.5 block">{escalations.filter(e => e.status === 'pending').length}</span>
                  </div>
                  <div className="border border-zinc-800 bg-zinc-900/20 p-4 rounded-xl">
                    <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block">Integrous Blocks</span>
                    <span className="text-xl font-bold text-zinc-100 mt-1.5 block">{auditLogs.length}</span>
                  </div>
                </div>

                {/* Security & Spending Digest (Parent / Co-signer Only) */}
                {currentUser?.role !== 'delegate' && (
                  <div className="border border-zinc-800 bg-zinc-900/10 p-5 rounded-xl space-y-4">
                    <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                        <Shield className="w-4 h-4 text-zinc-400" />
                        Weekly Security & Spending Digest
                      </h3>
                      <span className="px-2 py-0.5 text-[9px] font-bold bg-zinc-900 border border-zinc-800 text-zinc-400 rounded">
                        Generated {new Date().toLocaleDateString()}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {/* Spending Progress Bar */}
                      <div className="p-3 bg-zinc-900/30 border border-zinc-800/60 rounded-lg flex flex-col justify-between">
                        <div>
                          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">Monthly Delegated Spend</span>
                          <span className="text-lg font-bold text-zinc-200 mt-1 block">${totalMonthlySpend.toFixed(2)}</span>
                          <span className="text-[10px] text-zinc-500 block mt-0.5">Total across all pay_bills grants.</span>
                        </div>
                        <div className="mt-3">
                          <div className="w-full bg-zinc-950 h-1.5 rounded-full overflow-hidden border border-zinc-800">
                            <div 
                              className="bg-zinc-100 h-full transition-all duration-300"
                              style={{ width: `${Math.min((totalMonthlySpend / 2000) * 100, 100)}%` }}
                            ></div>
                          </div>
                          <div className="flex justify-between text-[8px] font-bold text-zinc-500 mt-1.5 uppercase">
                            <span>$0</span>
                            <span>Limit Cap ($2,000)</span>
                          </div>
                        </div>
                      </div>

                      {/* Urgency Alerts */}
                      <div className="p-3 bg-zinc-900/30 border border-zinc-800/60 rounded-lg flex flex-col justify-between space-y-2">
                        <div>
                          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">Policy & Boundary Alerts</span>
                        </div>
                        <div className="space-y-2 overflow-y-auto max-h-24 pr-1">
                          {expiringGrants.length === 0 && deniedAttempts.length === 0 && flaggedAnomalies.length === 0 ? (
                            <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium py-2">
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                              <span>All active bounds are secure. No anomalies.</span>
                            </div>
                          ) : (
                            <>
                              {expiringGrants.map(eg => (
                                <div key={eg._id} className="p-1.5 bg-amber-950/20 border border-amber-500/20 text-amber-400 rounded text-[10px] flex items-center justify-between">
                                  <span>Grant ({eg.domain}) expires soon</span>
                                  <button 
                                    onClick={() => handleRenewGrant(eg._id)}
                                    className="px-1.5 py-0.5 bg-amber-900/40 text-amber-200 border border-amber-800 hover:bg-amber-800 rounded font-bold transition-clean cursor-pointer text-[9px]"
                                  >
                                    Renew
                                  </button>
                                </div>
                              ))}
                              {flaggedAnomalies.slice(0, 3).map((an, idx) => (
                                <div key={idx} className="p-1.5 bg-red-950/20 border border-red-500/20 text-red-400 rounded text-[10px] flex flex-col">
                                  <div className="flex justify-between font-bold">
                                    <span>⚠️ ANOMALY ALERT</span>
                                    <span>{new Date(an.timestamp).toLocaleDateString()}</span>
                                  </div>
                                  <span className="text-zinc-400 mt-0.5 leading-normal">
                                    {an.anomalyReason} (Actor: {getMemberName(an.actorId)})
                                  </span>
                                </div>
                              ))}
                              {deniedAttempts.slice(0, 3).map((da, idx) => (
                                <div key={idx} className="p-1.5 bg-red-950/20 border border-red-500/20 text-red-400 rounded text-[10px] flex flex-col">
                                  <div className="flex justify-between font-bold">
                                    <span>Guardian Blocked Event</span>
                                    <span>{new Date(da.timestamp).toLocaleDateString()}</span>
                                  </div>
                                  <span className="text-zinc-400 mt-0.5 truncate">{da.target}</span>
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Simulated Balances Summary */}
                <div className="border border-zinc-800 bg-zinc-900/10 rounded-xl p-5 space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Scoped Bank Accounts</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {accounts.map(acc => (
                      <div key={acc.id} className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-lg flex justify-between items-center">
                        <div>
                          <h4 className="text-xs font-bold text-zinc-300">{acc.institution}</h4>
                          <span className="text-[10px] text-zinc-500">{acc.accountName}</span>
                        </div>
                        {currentUser?.role === 'delegate' ? (
                          <button
                            onClick={() => handleViewBalanceClick(acc.id, acc.domain)}
                            className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-300 rounded text-xs font-medium cursor-pointer"
                          >
                            View Balance
                          </button>
                        ) : (
                          <span className="text-xs font-mono font-bold text-zinc-200">${acc.balance.toFixed(2)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recent Event Log Section */}
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Recent Audit Logs</h3>
                  <div className="border border-zinc-800 rounded-lg divide-y divide-zinc-800 overflow-hidden bg-zinc-900/10">
                    {auditLogs.slice(0, 4).map(log => (
                      <div key={log._id} className="p-3 text-xs flex justify-between items-center gap-4">
                        <div className="flex items-center gap-2.5">
                          <span className="px-1.5 py-0.5 text-[9px] font-mono border border-zinc-800 text-zinc-400 rounded uppercase">
                            {log.actionType}
                          </span>
                          <span className="text-zinc-300">{log.target}</span>
                        </div>
                        <span className="text-zinc-500 text-[10px]">{new Date(log.timestamp).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB GRANTS */}
            {activeTab === 'grants' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-semibold text-zinc-100 tracking-tight">Oversight Boundaries</h2>
                    <p className="text-xs text-zinc-400 mt-1">Manage, approve, or revoke time-boxed delegations of access.</p>
                  </div>
                  {currentUser?.role === 'parent' && (
                    <button
                      onClick={() => {
                        const firstDelegate = familyMembers.find(f => f.role !== 'parent');
                        setNewGrantDelegate(firstDelegate ? firstDelegate.id : '');
                        setShowCreateGrant(true);
                      }}
                      className="px-3 py-1.5 bg-zinc-50 hover:bg-zinc-200 text-zinc-950 font-semibold rounded-lg text-xs cursor-pointer shadow-sm transition-clean"
                    >
                      New Delegation
                    </button>
                  )}
                </div>

                {/* Create Grant Form modal/panel */}
                {showCreateGrant && (
                  <form onSubmit={handleCreateGrant} className="border border-zinc-800 bg-zinc-900/30 p-5 rounded-xl space-y-4">
                    <div className="flex justify-between items-center pb-2 border-b border-zinc-800">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">Configure Delegation</h3>
                      <button type="button" onClick={() => setShowCreateGrant(false)} className="text-xs text-zinc-500 hover:text-zinc-300">Cancel</button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Delegate</label>
                        <select
                          value={newGrantDelegate}
                          onChange={e => setNewGrantDelegate(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300"
                          required
                        >
                          <option value="">Select a delegate...</option>
                          {familyMembers
                            .filter(f => f.role !== 'parent')
                            .map(f => (
                              <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Category / Domain</label>
                        <select
                          value={newGrantDomain}
                          onChange={e => setNewGrantDomain(e.target.value as any)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300"
                        >
                          <option value="financial">Financial (Balance & Bills)</option>
                          <option value="medical">Medical Portal</option>
                          <option value="household">Household Expenses</option>
                          <option value="insurance">Insurance Portals</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Access Scope</label>
                        <select
                          value={newGrantScope}
                          onChange={e => setNewGrantScope(e.target.value as any)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300"
                        >
                          <option value="view_only">View Only</option>
                          <option value="pay_bills">Pay Bills & Expenses</option>
                          <option value="full_manage">Full Control</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Duration</label>
                        <select
                          value={newGrantExpiryMonths}
                          onChange={e => setNewGrantExpiryMonths(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300"
                        >
                          <option value="1">1 Month (Short-term)</option>
                          <option value="3">3 Months (Standard)</option>
                          <option value="6">6 Months</option>
                          <option value="12">1 Year</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Single Transaction Cap ($)</label>
                        <input
                          type="number"
                          value={newGrantTxCap}
                          onChange={e => setNewGrantTxCap(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300"
                          min="0"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Monthly Cumulative Cap ($)</label>
                        <input
                          type="number"
                          value={newGrantMonthlyCap}
                          onChange={e => setNewGrantMonthlyCap(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300"
                          min="0"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Justification Reason</label>
                      <textarea
                        value={newGrantReason}
                        onChange={e => setNewGrantReason(e.target.value)}
                        placeholder="Purpose of delegating access"
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300 h-16 resize-none"
                        required
                      ></textarea>
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2 bg-zinc-50 hover:bg-zinc-200 text-zinc-950 font-bold rounded-lg text-xs transition-clean cursor-pointer"
                    >
                      Authorize & Sign Grant
                    </button>
                  </form>
                )}

                {/* Grants Table / Grid */}
                <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-900/10">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-900/30 text-zinc-400 font-medium">
                        <th className="p-3">Delegate</th>
                        <th className="p-3">Domain</th>
                        <th className="p-3">Scope</th>
                        <th className="p-3">Limits</th>
                        <th className="p-3">Expiry</th>
                        <th className="p-3">Status</th>
                        {currentUser?.role === 'parent' && <th className="p-3 text-right">Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {grants.length === 0 ? (
                        <tr>
                          <td colSpan={currentUser?.role === 'parent' ? 7 : 6} className="p-8 text-center text-zinc-500">
                            No active delegations found.
                          </td>
                        </tr>
                      ) : (
                        grants.map(grant => (
                          <tr key={grant._id} className="hover:bg-zinc-900/20">
                            <td className="p-3 font-semibold text-zinc-200">{getMemberName(grant.delegateId)}</td>
                            <td className="p-3">
                              <div className="flex items-center gap-1.5 capitalize text-zinc-300">
                                {getDomainIcon(grant.domain)}
                                <span>{grant.domain}</span>
                              </div>
                            </td>
                            <td className="p-3">{getScopeBadge(grant.scope)}</td>
                            <td className="p-3 font-mono text-[11px] text-zinc-400">
                              {grant.transactionCap > 0 ? `$${grant.transactionCap} tx` : 'Unlimited'}<br/>
                              {grant.monthlyCap > 0 ? `$${grant.monthlyCap}/mo` : 'Unlimited'}
                            </td>
                            <td className="p-3 text-zinc-400">{new Date(grant.expiresAt).toLocaleDateString()}</td>
                            <td className="p-3">{getStatusBadge(grant.status)}</td>
                            {currentUser?.role === 'parent' && (
                              <td className="p-3 text-right">
                                {grant.status === 'active' ? (
                                  <button
                                    onClick={() => handleRevokeGrant(grant._id)}
                                    className="px-2 py-1 bg-red-950/20 hover:bg-red-900/25 border border-red-500/20 text-red-400 font-medium rounded text-[10px] transition-clean cursor-pointer"
                                  >
                                    Revoke
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleRenewGrant(grant._id)}
                                    className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 font-medium rounded text-[10px] transition-clean cursor-pointer"
                                  >
                                    Renew
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB ESCALATIONS */}
            {activeTab === 'escalations' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-semibold text-zinc-100 tracking-tight">Scope Upgrades Quorum</h2>
                  <p className="text-xs text-zinc-400 mt-1">Review and sign off on requested delegation upgrades from co-signers.</p>
                </div>

                <div className="space-y-4">
                  {escalations.filter(e => e.status === 'pending').length === 0 ? (
                    <div className="border border-zinc-800 p-8 rounded-xl text-center text-zinc-500 text-xs">
                      No pending upgrades waiting for signatures.
                    </div>
                  ) : (
                    escalations
                      .filter(e => e.status === 'pending')
                      .map(req => {
                        const hasVoted = currentUser ? req.approvals.some(a => a.userId === currentUser.id) : false;

                        return (
                          <div key={req._id} className="border border-zinc-800 bg-zinc-900/10 p-5 rounded-xl space-y-4">
                            <div className="flex justify-between items-start">
                              <div>
                                <span className="px-2 py-0.5 text-[9px] font-bold border border-indigo-900/30 bg-indigo-950/10 text-indigo-400 rounded uppercase">Quorum Audit Required</span>
                                <h4 className="text-sm font-semibold text-zinc-200 mt-2">
                                  Operator Upgrading: {getMemberName(req.requestedBy)}
                                </h4>
                                 <p className="text-xs text-zinc-400 mt-1">
                                  Requests access upgrade to: <span className="font-semibold text-zinc-200">
                                    {req.requestedScope === 'full_manage' ? 'Full Control' : req.requestedScope === 'pay_bills' ? 'Pay Bills' : 'View Only'}
                                  </span>
                                </p>
                              </div>
                              <span className="text-xs font-mono text-zinc-400">
                                Signatures: {req.approvals.filter(a => a.decision === 'approved').length} / {req.approversRequired}
                              </span>
                            </div>

                            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 italic">
                              "{req.justification}"
                            </div>

                            {/* Sign inputs */}
                            {currentUser && (currentUser.role === 'co_signer' || currentUser.role === 'parent') && (
                              <div className="space-y-3 pt-3 border-t border-zinc-800/80">
                                <input
                                  type="text"
                                  placeholder="Sign note / comment (optional)"
                                  value={approvalNotes[req._id] || ''}
                                  onChange={e => setApprovalNotes(prev => ({ ...prev, [req._id]: e.target.value }))}
                                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300"
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => handleApproveEscalation(req._id, 'approved')}
                                    disabled={hasVoted}
                                    className="flex-1 py-1.5 bg-zinc-50 hover:bg-zinc-200 disabled:opacity-50 text-zinc-950 font-bold rounded-lg text-xs transition-clean cursor-pointer"
                                  >
                                    {hasVoted ? 'Signed & Signed' : 'Sign and Approve'}
                                  </button>
                                  <button
                                    onClick={() => handleApproveEscalation(req._id, 'denied')}
                                    disabled={hasVoted}
                                    className="px-4 py-1.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 border border-zinc-800 text-red-400 hover:text-red-300 font-bold rounded-lg text-xs transition-clean cursor-pointer"
                                  >
                                    Block
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                  )}
                </div>

                {/* History list */}
                {escalations.filter(e => e.status !== 'pending').length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Escalation Decisions History</h3>
                    <div className="border border-zinc-800 rounded-lg divide-y divide-zinc-800 overflow-hidden bg-zinc-900/10">
                      {escalations
                        .filter(e => e.status !== 'pending')
                        .map(h => (
                          <div key={h._id} className="p-3 text-xs flex justify-between items-center">
                            <div>
                              <span className="font-semibold text-zinc-300">{getMemberName(h.requestedBy)}</span>
                              <span className="text-zinc-500"> upgraded to {h.requestedScope === 'full_manage' ? 'Full Control' : h.requestedScope === 'pay_bills' ? 'Pay Bills' : 'View Only'}</span>
                            </div>
                            <span className={`font-bold ${h.status === 'approved' ? 'text-emerald-400' : 'text-red-400'}`}>
                              {h.status.toUpperCase()}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB AUDIT TRAIL */}
            {activeTab === 'audit' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-semibold text-zinc-100 tracking-tight">Audit Ledger</h2>
                    <p className="text-xs text-zinc-400 mt-1">Cryptographically hash-chained trail of all access checks and database mutations.</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleDownloadPDF}
                      className="px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-lg text-xs font-semibold cursor-pointer transition-clean flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      PDF Report
                    </button>
                    <button
                      onClick={handleDownloadCSV}
                      className="px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-lg text-xs font-semibold cursor-pointer transition-clean flex items-center gap-1.5"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      CSV File
                    </button>
                  </div>
                </div>

                {/* Validation Actions */}
                <div className="border border-zinc-800 bg-zinc-900/10 p-4 rounded-xl flex items-center justify-between gap-4">
                  <div className="text-xs">
                    <h4 className="font-bold text-zinc-300">Run Chain Guard Integrity Analysis</h4>
                    <p className="text-zinc-500 mt-0.5">Recalculate SHA-256 links from block genesis forward to check for manual tampering.</p>
                  </div>
                  <button
                    onClick={handleVerifyChain}
                    disabled={verifyingChain}
                    className="px-3 py-1.5 bg-zinc-50 hover:bg-zinc-200 text-zinc-950 font-bold rounded-lg text-xs transition-clean cursor-pointer flex items-center gap-1.5"
                  >
                    {verifyingChain ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      'Validate Chain'
                    )}
                  </button>
                </div>

                {chainValid !== null && (
                  <div className={`p-4 rounded-xl border text-xs flex items-center gap-2 ${
                    chainValid
                      ? 'bg-emerald-950/20 border-emerald-500/20 text-emerald-400'
                      : 'bg-red-950/20 border-red-500/20 text-red-400'
                  }`}>
                    {chainValid ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>Audit Chain Validated: All hash chains are cryptographically sound.</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                        <span>TAMPER WARNING: Database tampering detected! Chain link integrity is broken.</span>
                      </>
                    )}
                  </div>
                )}

                {/* Audit filter inputs */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Search Details</label>
                    <input
                      type="text"
                      placeholder="Search description, operator..."
                      value={auditSearch}
                      onChange={e => setAuditSearch(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300 font-sans"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Filter Operator</label>
                    <select
                      value={auditActorFilter}
                      onChange={e => setAuditActorFilter(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300"
                    >
                      <option value="all">All Operators</option>
                      <option value="SYSTEM">System Chain Guard</option>
                      {familyMembers.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Filter Action</label>
                    <select
                      value={auditActionFilter}
                      onChange={e => setAuditActionFilter(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300"
                    >
                      <option value="all">All Actions</option>
                      <option value="viewed_balance">Viewed Balance</option>
                      <option value="paid_bill">Paid Bill</option>
                      <option value="added_payee">Added Payee</option>
                      <option value="action_denied">Action Blocked</option>
                      <option value="escalation_requested">Escalation Requested</option>
                      <option value="escalation_approved">Escalation Approved</option>
                      <option value="grant_revoked">Grant Revoked</option>
                      <option value="grant_expired">Grant Expired</option>
                    </select>
                  </div>
                </div>

                {/* Audit logs table */}
                <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-900/10">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-900/30 text-zinc-400 font-medium">
                        <th className="p-3">Time</th>
                        <th className="p-3">Action</th>
                        <th className="p-3">Operator</th>
                        <th className="p-3">Details / Target</th>
                        <th className="p-3">Block Hash</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800 font-mono text-[11px]">
                      {(() => {
                        const filteredLogs = auditLogs.filter(log => {
                          if (auditSearch) {
                            const query = auditSearch.toLowerCase();
                            const targetMatches = log.target.toLowerCase().includes(query);
                            const actionMatches = log.actionType.toLowerCase().includes(query);
                            const operatorName = getMemberName(log.actorId).toLowerCase();
                            const operatorMatches = operatorName.includes(query);
                            if (!targetMatches && !actionMatches && !operatorMatches) return false;
                          }
                          if (auditActorFilter !== 'all' && log.actorId !== auditActorFilter) {
                            return false;
                          }
                          if (auditActionFilter !== 'all' && log.actionType !== auditActionFilter) {
                            return false;
                          }
                          return true;
                        });

                        if (filteredLogs.length === 0) {
                          return (
                            <tr>
                              <td colSpan={5} className="p-8 text-center text-zinc-500 font-sans">
                                No matching audit logs found.
                              </td>
                            </tr>
                          );
                        }

                        return filteredLogs.map(log => (
                          <tr key={log._id} className="hover:bg-zinc-900/20">
                            <td className="p-3 text-zinc-500 whitespace-nowrap">{new Date(log.timestamp).toLocaleTimeString()}</td>
                            <td className="p-3 font-sans font-medium">
                              <div className="flex flex-col gap-1 items-start">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                                  log.actionType.includes('denied')
                                    ? 'border-red-950/20 bg-red-950/10 text-red-400'
                                    : 'border-zinc-800 bg-zinc-900 text-zinc-300'
                                }`}>
                                   {log.actionType.replace('_', ' ')}
                                 </span>
                                 {(log as any).isAnomaly && (
                                   <span className="px-1.5 py-0.5 rounded text-[9px] font-bold border border-red-500/30 bg-red-950/30 text-red-400">
                                     ANOMALY
                                   </span>
                                 )}
                              </div>
                            </td>
                            <td className="p-3 font-sans text-zinc-300">{getMemberName(log.actorId)}</td>
                            <td className="p-3 font-sans text-zinc-200">
                              <div>{log.target}</div>
                              {log.amount !== null && <span className="font-mono font-bold text-zinc-300 block mt-0.5">${log.amount.toFixed(2)}</span>}
                              {(log as any).isAnomaly && (log as any).anomalyReason && (
                                <div className="text-[10px] text-red-400 mt-1.5 bg-red-950/10 border border-red-900/10 p-1.5 rounded leading-normal">
                                  <strong>Alert:</strong> {(log as any).anomalyReason}
                                </div>
                              )}
                            </td>
                            <td className="p-3 text-zinc-500 truncate max-w-[120px]">{log.eventHash.substring(0, 16)}...</td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB SANDBOX BANK */}
            {activeTab === 'sandbox' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-semibold text-zinc-100 tracking-tight">Simulated Institution Sandbox</h2>
                  <p className="text-xs text-zinc-400 mt-1">Simulate delegate logins and attempt balance lookups or payment requests.</p>
                </div>

                {/* Scope info banner */}
                <div className="p-4 border border-zinc-800 bg-zinc-900/20 rounded-xl space-y-2">
                  <div className="flex gap-3">
                    <Shield className="w-5 h-5 text-zinc-400 mt-0.5 flex-shrink-0" />
                    <div className="text-xs">
                      <h4 className="font-bold text-zinc-200">Guardian Gate — Domain-Scoped Enforcement</h4>
                      <p className="mt-1 text-zinc-400 leading-relaxed">
                        Each bill and account belongs to a <strong className="text-zinc-300">domain</strong> (Financial, Household, Medical). Priya can only interact with items whose domain matches an active grant she holds. Bills are automatically labelled with their domain below.
                      </p>
                    </div>
                  </div>
                  <div className="ml-8 flex gap-3 flex-wrap text-[10px] font-medium">
                    <span className="px-2 py-1 rounded border border-blue-900/30 bg-blue-950/10 text-blue-400">Financial grant → Financial bills</span>
                    <span className="px-2 py-1 rounded border border-violet-900/30 bg-violet-950/10 text-violet-400">Household grant → Household bills</span>
                    <span className="px-2 py-1 rounded border border-emerald-900/30 bg-emerald-950/10 text-emerald-400">Medical grant → Medical bills</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  {/* Accounts Column */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Bank Accounts</h3>
                    <div className="space-y-3">
                      {accounts.map(acc => (
                        <div key={acc.id} className="p-4 bg-zinc-900/40 border border-zinc-800 rounded-xl space-y-3">
                          <div className="flex justify-between items-start">
                            <div>
                              <h4 className="text-xs font-bold text-zinc-200">{acc.institution}</h4>
                              <p className="text-[10px] text-zinc-500">{acc.accountName} ({acc.accountNumber})</p>
                            </div>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border capitalize ${
                              acc.domain === 'financial' ? 'border-blue-900/30 bg-blue-950/10 text-blue-400'
                              : acc.domain === 'medical' ? 'border-emerald-900/30 bg-emerald-950/10 text-emerald-400'
                              : 'border-violet-900/30 bg-violet-950/10 text-violet-400'
                            }`}>{acc.domain}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-bold font-mono text-zinc-400">
                              {currentUser?.role === 'delegate' ? '••••••' : `$${acc.balance.toFixed(2)}`}
                            </span>
                            <button
                              onClick={() => handleViewBalanceClick(acc.id, acc.domain)}
                              className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded text-xs font-medium cursor-pointer"
                            >
                              View Balance
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Add Custom Expense Form */}
                    <div className="border border-zinc-800 bg-zinc-900/10 p-4 rounded-xl space-y-3 mt-4">
                      <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Plus className="w-3.5 h-3.5 text-zinc-400" />
                        Add Custom Payee / Expense
                      </h4>
                      <p className="text-[10px] text-zinc-500 leading-normal">
                        Simulate adding a new expense payee. <em>Requires `full_manage` scope for delegates.</em>
                      </p>
                      <form onSubmit={handleAddPayeeClick} className="space-y-3 pt-1 font-sans">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Payee Name</label>
                            <input
                              type="text"
                              placeholder="e.g. Acme Corp"
                              value={newPayeeName}
                              onChange={e => setNewPayeeName(e.target.value)}
                              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-1.5 text-[11px] text-zinc-300 font-sans"
                              required
                            />
                          </div>
                          <div>
                            <label className="block text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Amount ($)</label>
                            <input
                              type="number"
                              placeholder="e.g. 150"
                              value={newPayeeAmount}
                              onChange={e => setNewPayeeAmount(e.target.value)}
                              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-1.5 text-[11px] text-zinc-300 font-sans"
                              required
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Domain Category</label>
                          <div className="flex gap-2">
                            <select
                              value={newPayeeDomain}
                              onChange={e => setNewPayeeDomain(e.target.value)}
                              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg p-1.5 text-[11px] text-zinc-300"
                            >
                              <option value="household">Household Domain</option>
                              <option value="medical">Medical Domain</option>
                              <option value="financial">Financial Domain</option>
                              <option value="insurance">Insurance Domain</option>
                            </select>
                            <button
                              type="submit"
                              className="px-4 py-1.5 bg-zinc-50 hover:bg-zinc-200 text-zinc-950 font-bold rounded-lg text-xs transition-clean cursor-pointer whitespace-nowrap"
                            >
                              Add Payee
                            </button>
                          </div>
                        </div>
                      </form>
                    </div>
                  </div>

                  {/* Bills Column */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Pending Bills</h3>
                    <div className="space-y-3">
                      {bills.map(bill => (
                        <div key={bill.id} className={`p-4 bg-zinc-900/40 border rounded-xl space-y-3 ${
                          bill.status === 'paid' ? 'border-zinc-800/40 opacity-60' : 'border-zinc-800'
                        }`}>
                          <div className="flex justify-between items-start">
                            <div>
                              <h4 className="text-xs font-bold text-zinc-200">{bill.payee}</h4>
                              <span className="text-[10px] text-zinc-500">Due: {new Date(bill.dueDate).toLocaleDateString()}</span>
                            </div>
                            <span className="text-xs font-mono font-bold text-zinc-100">${bill.amount.toFixed(2)}</span>
                          </div>

                          <div className="flex justify-between items-center pt-2 border-t border-zinc-800/50">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border capitalize ${
                              bill.domain === 'financial' ? 'border-blue-900/30 bg-blue-950/10 text-blue-400'
                              : bill.domain === 'medical' ? 'border-emerald-900/30 bg-emerald-950/10 text-emerald-400'
                              : 'border-violet-900/30 bg-violet-950/10 text-violet-400'
                            }`}>{bill.domain} domain</span>
                            {bill.status === 'paid' ? (
                              <span className="px-2 py-0.5 text-[10px] font-bold border border-emerald-900/30 bg-emerald-950/20 text-emerald-400 rounded">
                                Paid
                              </span>
                            ) : (
                              <button
                                onClick={() => handlePayBillClick(bill.id, bill.domain, bill.amount)}
                                className="px-2.5 py-1 bg-zinc-50 hover:bg-zinc-200 text-zinc-950 rounded text-xs font-bold cursor-pointer"
                              >
                                Pay Bill
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Initiate Escalation launcher */}
                {currentUser?.role === 'delegate' && (
                  <div className="border border-zinc-800 bg-zinc-900/10 p-5 rounded-xl text-center space-y-3 max-w-md mx-auto">
                    <h4 className="text-xs font-bold text-zinc-200">Request Scope Escalation Upgrade</h4>
                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                      Need permission to pay expenses or manage accounts? Submit a time-boxed request to sibling co-signers.
                    </p>
                    <button
                      onClick={() => {
                        const active = grants.filter(g => g.status === 'active' || g.status === 'escalation_pending');
                        if (active.length === 0) {
                          alert('You hold no active grants to escalate.');
                          return;
                        }
                        setEscalateGrantId(active[0]._id);
                        setShowEscalationModal(true);
                      }}
                      className="px-3 py-1.5 bg-zinc-50 hover:bg-zinc-200 text-zinc-950 font-bold rounded-lg text-xs cursor-pointer transition-clean"
                    >
                      Request Scope Escalation
                    </button>
                  </div>
                )}

                {/* Escalation launcher modal */}
                {showEscalationModal && (
                  <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
                    <form onSubmit={handleRequestEscalation} className="w-full max-w-md border border-zinc-800 bg-zinc-900 p-6 rounded-xl space-y-4">
                      <div className="flex justify-between items-center pb-2 border-b border-zinc-800">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">Escalate Delegation Scope</h3>
                        <button type="button" onClick={() => setShowEscalationModal(false)} className="text-xs text-zinc-500 hover:text-zinc-300">Close</button>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Target Grant (Domain)</label>
                        <select
                          value={escalateGrantId}
                          onChange={e => setEscalateGrantId(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300"
                          required
                        >
                          {grants.map(g => {
                            const domainLabels: Record<string, string> = {
                              financial: 'Financial (Balance & Bills)',
                              medical: 'Medical Portal',
                              household: 'Household Expenses',
                              insurance: 'Insurance Portal'
                            };
                            const scopeLabels: Record<string, string> = {
                              view_only: 'View Only',
                              pay_bills: 'Pay Bills',
                              full_manage: 'Full Control'
                            };
                            return (
                              <option key={g._id} value={g._id}>
                                {domainLabels[g.domain] || g.domain} (Current: {scopeLabels[g.scope] || g.scope})
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Requested Scope Level</label>
                        <select
                          value={escalateScope}
                          onChange={e => setEscalateScope(e.target.value as any)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300"
                        >
                          <option value="pay_bills">Pay Bills & Expenses</option>
                          <option value="full_manage">Full Control</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Justification Reason</label>
                        <textarea
                          value={escalateJustification}
                          onChange={e => setEscalateJustification(e.target.value)}
                          placeholder="Justification note for siblings"
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300 h-20 resize-none"
                          required
                        ></textarea>
                      </div>

                      <button
                        type="submit"
                        className="w-full py-2 bg-zinc-50 hover:bg-zinc-200 text-zinc-950 font-bold rounded-lg text-xs transition-clean cursor-pointer"
                      >
                        Submit Request
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}
          </main>

          {/* 3. RIGHT SIDE GUARDIAN VISUAL PANEL */}
          <aside className="w-80 border-l border-zinc-800 bg-zinc-950 p-6 space-y-6 flex-shrink-0 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-zinc-400" />
                  Guardian Shield
                </h3>
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span className="text-[9px] font-mono text-emerald-400 font-semibold">ACTIVE</span>
                </span>
              </div>

              {/* Status Display */}
              <div className={`p-4 rounded-lg border text-xs leading-relaxed space-y-2 ${
                guardianLog.status === 'approved'
                  ? 'bg-emerald-950/20 border-emerald-500/20 text-emerald-400'
                  : guardianLog.status === 'denied'
                  ? 'bg-red-950/20 border-red-500/20 text-red-400'
                  : 'bg-zinc-900/50 border-zinc-800 text-zinc-300'
              }`}>
                <div className="flex items-center gap-2">
                  {guardianLog.status === 'approved' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  {guardianLog.status === 'denied' && <XCircle className="w-4 h-4 text-red-400" />}
                  {guardianLog.status === 'idle' && <Shield className="w-4 h-4 text-zinc-400" />}
                  <span className="font-semibold">{guardianLog.message}</span>
                </div>
                {guardianLog.details && (
                  <p className="text-[11px] text-zinc-400 mt-1 border-t border-zinc-800/40 pt-1.5 leading-normal">
                    {guardianLog.details}
                  </p>
                )}
              </div>
            </div>

            {/* Quick Developer Testing Info */}
            <div className="border border-zinc-800 bg-zinc-900/10 p-3.5 rounded-xl text-[11px] text-zinc-500 space-y-2 leading-relaxed">
              <span className="font-bold text-zinc-400 uppercase text-[9px] tracking-wider block">Security Rule Checker</span>
              <p>Every transaction, balance query, or configuration change is intercepted. The system enforces cryptographic validation on the data store directly.</p>
            </div>
          </aside>

        </div>
      </div>

      {/* Action Reason Modal */}
      {reasonModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <form onSubmit={handleReasonSubmit} className="w-full max-w-md border border-zinc-800 bg-zinc-900 p-6 rounded-xl space-y-4 shadow-xl">
            <div className="flex justify-between items-center pb-2 border-b border-zinc-800">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" />
                Security Justification
              </h3>
              <button type="button" onClick={() => setReasonModalOpen(false)} className="text-xs text-zinc-500 hover:text-zinc-300">Close</button>
            </div>

            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-[11px] text-zinc-400 space-y-1.5">
              <p><strong>Action:</strong> {reasonActionType === 'view_balance' ? 'View Balance query' : 'Pay Bill transaction'}</p>
              <p><strong>Domain:</strong> <span className="capitalize">{reasonDomain}</span></p>
              {reasonAmount !== null && <p><strong>Amount:</strong> ${reasonAmount.toFixed(2)}</p>}
            </div>

            <div>
              <label className="block text-[9px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Enter Reason for Access</label>
              <textarea
                value={actionReasonText}
                onChange={e => setActionReasonText(e.target.value)}
                placeholder="e.g., Checking if utility payment cleared / paying PG&E bill"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300 h-20 resize-none font-sans"
                required
              ></textarea>
            </div>

            <button
              type="submit"
              className="w-full py-2 bg-zinc-50 hover:bg-zinc-200 text-zinc-950 font-bold rounded-lg text-xs transition-clean cursor-pointer"
            >
              Submit Justified Request
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

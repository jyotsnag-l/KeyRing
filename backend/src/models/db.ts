import mongoose, { Schema } from 'mongoose';
import {
  IUser,
  IGrant,
  IEscalationRequest,
  IAuditEvent,
  ISimulatedAccount,
  ISimulatedBill
} from './types';

// Let's declare our flag for mock database fallback
export let isMockDatabase = false;

// Dynamic import of MongoMemoryServer to handle setup without crash
let MongoMemoryServer: any = null;
try {
  MongoMemoryServer = require('mongodb-memory-server').MongoMemoryServer;
} catch (e) {
  console.warn('[DB SETUP] mongodb-memory-server is not available. Fallback to full mock mode will be used if real mongo fails.');
}

// ----------------------------------------------------
// MONGOOSE SCHEMA DEFINITIONS
// ----------------------------------------------------
const UserSchema = new Schema<IUser>({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['parent', 'delegate', 'co_signer', 'sibling', 'advisor'], required: true },
  familyId: { type: String, required: true },
  familyQuorum: { type: Number, default: 1 }
});

const GrantSchema = new Schema<IGrant>({
  parentId: { type: String, required: true },
  delegateId: { type: String, required: true },
  scope: { type: String, enum: ['view_only', 'pay_bills', 'full_manage'], required: true },
  domain: { type: String, enum: ['financial', 'medical', 'household', 'insurance'], required: true },
  reason: { type: String, required: true },
  createdBy: { type: String, required: true },
  startAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'active', 'expired', 'revoked', 'escalation_pending'], required: true },
  coSigners: [{ type: String }],
  parentAck: { type: Boolean, default: false },
  transactionCap: { type: Number, default: 0 },
  monthlyCap: { type: Number, default: 0 }
});

const EscalationRequestSchema = new Schema<IEscalationRequest>({
  grantId: { type: String, required: true },
  requestedBy: { type: String, required: true },
  requestedScope: { type: String, enum: ['view_only', 'pay_bills', 'full_manage'], required: true },
  justification: { type: String, required: true },
  approversRequired: { type: Number, required: true },
  approvals: [{
    userId: { type: String, required: true },
    decision: { type: String, enum: ['approved', 'denied'], required: true },
    timestamp: { type: Date, default: Date.now },
    note: { type: String }
  }],
  status: { type: String, enum: ['pending', 'approved', 'denied', 'expired'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const AuditEventSchema = new Schema<IAuditEvent>({
  grantId: { type: String, default: null },
  actorId: { type: String, required: true },
  actionType: { type: String, required: true },
  target: { type: String, required: true },
  amount: { type: Number, default: null },
  timestamp: { type: Date, default: Date.now },
  prevEventHash: { type: String, required: true },
  eventHash: { type: String, required: true },
  isAnomaly: { type: Boolean, default: false },
  anomalyReason: { type: String, default: '' }
});

const SimulatedAccountSchema = new Schema<ISimulatedAccount>({
  familyId: { type: String, required: true },
  institution: { type: String, required: true },
  accountName: { type: String, required: true },
  accountNumber: { type: String, required: true },
  balance: { type: Number, required: true },
  domain: { type: String, enum: ['financial', 'medical', 'household', 'insurance'], required: true }
});

const SimulatedBillSchema = new Schema<ISimulatedBill>({
  familyId: { type: String, required: true },
  payee: { type: String, required: true },
  amount: { type: Number, required: true },
  dueDate: { type: Date, required: true },
  domain: { type: String, enum: ['financial', 'medical', 'household', 'insurance'], required: true },
  status: { type: String, enum: ['pending', 'paid'], default: 'pending' }
});

// Models (will be initialized if mongoose connects successfully)
let UserModel: any;
let GrantModel: any;
let EscalationRequestModel: any;
let AuditEventModel: any;
let SimulatedAccountModel: any;
let SimulatedBillModel: any;

// ----------------------------------------------------
// IN-MEMORY MOCK DATA STORES
// ----------------------------------------------------
const mockStore = {
  users: [] as IUser[],
  grants: [] as IGrant[],
  escalations: [] as IEscalationRequest[],
  auditEvents: [] as IAuditEvent[],
  accounts: [] as ISimulatedAccount[],
  bills: [] as ISimulatedBill[]
};

// Helper for generating IDs in mock mode
const generateId = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

// ----------------------------------------------------
// DATABASE INITIALIZATION
// ----------------------------------------------------
export async function connectDB(): Promise<void> {
  const mongoUri = process.env.MONGO_URI;

  if (mongoUri) {
    try {
      console.log('[DB] Connecting to MongoDB from env...');
      await mongoose.connect(mongoUri);
      console.log('[DB] Connected to MongoDB successfully.');
      initMongooseModels();
      return;
    } catch (err) {
      console.error('[DB] Failed to connect to MONGO_URI. Trying fallback...', err);
    }
  }

  // Try MongoMemoryServer fallback
  if (MongoMemoryServer) {
    try {
      console.log('[DB] Starting MongoDB Memory Server fallback...');
      const mongoServer = await MongoMemoryServer.create();
      const uri = mongoServer.getUri();
      await mongoose.connect(uri);
      console.log('[DB] Connected to MongoDB Memory Server successfully.');
      initMongooseModels();
      return;
    } catch (err) {
      console.error('[DB] Failed to start MongoDB Memory Server. Falling back to clean Mock Memory Database...', err);
    }
  }

  // Fallback to memory array mock
  console.warn('[DB] ---------------------------------------------------------------');
  console.warn('[DB] WARNING: Using fully in-memory mock database array fallback!');
  console.warn('[DB] All data will be lost when the server restarts.');
  console.warn('[DB] ---------------------------------------------------------------');
  isMockDatabase = true;
  seedMockData();
}

function initMongooseModels() {
  UserModel = mongoose.model<IUser>('User', UserSchema);
  GrantModel = mongoose.model<IGrant>('Grant', GrantSchema);
  EscalationRequestModel = mongoose.model<IEscalationRequest>('EscalationRequest', EscalationRequestSchema);
  AuditEventModel = mongoose.model<IAuditEvent>('AuditEvent', AuditEventSchema);
  SimulatedAccountModel = mongoose.model<ISimulatedAccount>('SimulatedAccount', SimulatedAccountSchema);
  SimulatedBillModel = mongoose.model<ISimulatedBill>('SimulatedBill', SimulatedBillSchema);
}

// ----------------------------------------------------
// REPOSITORY IMPLEMENTATIONS
// ----------------------------------------------------

export const db = {
  async reset(): Promise<void> {
    if (isMockDatabase) {
      mockStore.users = [];
      mockStore.grants = [];
      mockStore.escalations = [];
      mockStore.auditEvents = [];
      mockStore.accounts = [];
      mockStore.bills = [];
    } else {
      if (UserModel) await UserModel.deleteMany({});
      if (GrantModel) await GrantModel.deleteMany({});
      if (EscalationRequestModel) await EscalationRequestModel.deleteMany({});
      if (AuditEventModel) await AuditEventModel.deleteMany({});
      if (SimulatedAccountModel) await SimulatedAccountModel.deleteMany({});
      if (SimulatedBillModel) await SimulatedBillModel.deleteMany({});
    }
  },
  users: {
    async create(user: Omit<IUser, '_id'>): Promise<IUser> {
      if (isMockDatabase) {
        const newUser = { ...user, _id: generateId() };
        mockStore.users.push(newUser);
        return newUser;
      }
      const doc = new UserModel(user);
      await doc.save();
      return doc.toObject();
    },
    async findOne(filter: Partial<IUser>): Promise<IUser | null> {
      if (isMockDatabase) {
        return mockStore.users.find(u => {
          return Object.entries(filter).every(([key, val]) => (u as any)[key] === val);
        }) || null;
      }
      const doc = await UserModel.findOne(filter);
      return doc ? doc.toObject() : null;
    },
    async findById(id: string): Promise<IUser | null> {
      if (isMockDatabase) {
        return mockStore.users.find(u => u._id === id) || null;
      }
      const doc = await UserModel.findById(id);
      return doc ? doc.toObject() : null;
    },
    async find(filter: Partial<IUser> = {}): Promise<IUser[]> {
      if (isMockDatabase) {
        return mockStore.users.filter(u => {
          return Object.entries(filter).every(([key, val]) => (u as any)[key] === val);
        });
      }
      const docs = await UserModel.find(filter);
      return docs.map(d => d.toObject());
    }
  },

  grants: {
    async create(grant: Omit<IGrant, '_id'>): Promise<IGrant> {
      if (isMockDatabase) {
        const newGrant = { ...grant, _id: generateId() };
        mockStore.grants.push(newGrant);
        return newGrant;
      }
      const doc = new GrantModel(grant);
      await doc.save();
      return doc.toObject();
    },
    async find(filter: Partial<IGrant> = {}): Promise<IGrant[]> {
      if (isMockDatabase) {
        return mockStore.grants.filter(g => {
          return Object.entries(filter).every(([key, val]) => {
            if (val instanceof Date) {
              return (g as any)[key].getTime() === val.getTime();
            }
            if (Array.isArray(val)) {
              return JSON.stringify((g as any)[key]) === JSON.stringify(val);
            }
            return (g as any)[key] === val;
          });
        });
      }
      const docs = await GrantModel.find(filter);
      return docs.map(d => d.toObject());
    },
    async findById(id: string): Promise<IGrant | null> {
      if (isMockDatabase) {
        return mockStore.grants.find(g => g._id === id) || null;
      }
      const doc = await GrantModel.findById(id);
      return doc ? doc.toObject() : null;
    },
    async updateOne(id: string, update: Partial<IGrant>): Promise<IGrant | null> {
      if (isMockDatabase) {
        const idx = mockStore.grants.findIndex(g => g._id === id);
        if (idx === -1) return null;
        mockStore.grants[idx] = { ...mockStore.grants[idx], ...update };
        return mockStore.grants[idx];
      }
      const doc = await GrantModel.findByIdAndUpdate(id, update, { new: true });
      return doc ? doc.toObject() : null;
    },
    async findExpired(now: Date): Promise<IGrant[]> {
      if (isMockDatabase) {
        return mockStore.grants.filter(g => g.status === 'active' && g.expiresAt <= now);
      }
      const docs = await GrantModel.find({ status: 'active', expiresAt: { $lte: now } });
      return docs.map(d => d.toObject());
    }
  },

  escalations: {
    async create(req: Omit<IEscalationRequest, '_id' | 'createdAt'>): Promise<IEscalationRequest> {
      if (isMockDatabase) {
        const newReq = { ...req, _id: generateId(), createdAt: new Date() };
        mockStore.escalations.push(newReq);
        return newReq;
      }
      const doc = new EscalationRequestModel(req);
      await doc.save();
      return doc.toObject();
    },
    async findById(id: string): Promise<IEscalationRequest | null> {
      if (isMockDatabase) {
        return mockStore.escalations.find(e => e._id === id) || null;
      }
      const doc = await EscalationRequestModel.findById(id);
      return doc ? doc.toObject() : null;
    },
    async find(filter: any = {}): Promise<IEscalationRequest[]> {
      if (isMockDatabase) {
        return mockStore.escalations.filter(e => {
          return Object.entries(filter).every(([key, val]) => (e as any)[key] === val);
        });
      }
      const docs = await EscalationRequestModel.find(filter);
      return docs.map(d => d.toObject());
    },
    async updateOne(id: string, update: Partial<IEscalationRequest>): Promise<IEscalationRequest | null> {
      if (isMockDatabase) {
        const idx = mockStore.escalations.findIndex(e => e._id === id);
        if (idx === -1) return null;
        mockStore.escalations[idx] = { ...mockStore.escalations[idx], ...update };
        return mockStore.escalations[idx];
      }
      const doc = await EscalationRequestModel.findByIdAndUpdate(id, update, { new: true });
      return doc ? doc.toObject() : null;
    }
  },

  audit: {
    async create(event: Omit<IAuditEvent, '_id'>): Promise<IAuditEvent> {
      if (isMockDatabase) {
        const newEvent = { ...event, _id: generateId() };
        mockStore.auditEvents.push(newEvent);
        return newEvent;
      }
      const doc = new AuditEventModel(event);
      await doc.save();
      return doc.toObject();
    },
    async find(filter: any = {}): Promise<IAuditEvent[]> {
      if (isMockDatabase) {
        return mockStore.auditEvents.filter(e => {
          return Object.entries(filter).every(([key, val]) => (e as any)[key] === val);
        });
      }
      const docs = await AuditEventModel.find(filter).sort({ timestamp: 1 });
      return docs.map(d => d.toObject());
    },
    async findLatest(grantId?: string): Promise<IAuditEvent | null> {
      if (isMockDatabase) {
        const filtered = grantId
          ? mockStore.auditEvents.filter(e => e.grantId === grantId)
          : mockStore.auditEvents;
        if (filtered.length === 0) return null;
        return filtered[filtered.length - 1];
      }
      const query = grantId ? { grantId } : {};
      const doc = await AuditEventModel.findOne(query).sort({ timestamp: -1 });
      return doc ? doc.toObject() : null;
    }
  },

  accounts: {
    async create(acc: Omit<ISimulatedAccount, 'id'>): Promise<ISimulatedAccount> {
      if (isMockDatabase) {
        const newAcc = { ...acc, id: generateId() };
        mockStore.accounts.push(newAcc);
        return newAcc;
      }
      const doc = new SimulatedAccountModel(acc);
      await doc.save();
      const obj = doc.toObject();
      return { ...obj, id: obj._id.toString() };
    },
    async find(filter: any = {}): Promise<ISimulatedAccount[]> {
      if (isMockDatabase) {
        return mockStore.accounts.filter(a => {
          return Object.entries(filter).every(([key, val]) => (a as any)[key] === val);
        });
      }
      const docs = await SimulatedAccountModel.find(filter);
      return docs.map(d => {
        const obj = d.toObject();
        return { ...obj, id: obj._id.toString() };
      });
    },
    async findById(id: string): Promise<ISimulatedAccount | null> {
      if (isMockDatabase) {
        return mockStore.accounts.find(a => a.id === id) || null;
      }
      const doc = await SimulatedAccountModel.findById(id);
      if (!doc) return null;
      const obj = doc.toObject();
      return { ...obj, id: obj._id.toString() };
    },
    async updateOne(id: string, update: Partial<ISimulatedAccount>): Promise<ISimulatedAccount | null> {
      if (isMockDatabase) {
        const idx = mockStore.accounts.findIndex(a => a.id === id);
        if (idx === -1) return null;
        mockStore.accounts[idx] = { ...mockStore.accounts[idx], ...update };
        return mockStore.accounts[idx];
      }
      const doc = await SimulatedAccountModel.findByIdAndUpdate(id, update, { new: true });
      if (!doc) return null;
      const obj = doc.toObject();
      return { ...obj, id: obj._id.toString() };
    }
  },

  bills: {
    async create(bill: Omit<ISimulatedBill, 'id'>): Promise<ISimulatedBill> {
      if (isMockDatabase) {
        const newBill = { ...bill, id: generateId() };
        mockStore.bills.push(newBill);
        return newBill;
      }
      const doc = new SimulatedBillModel(bill);
      await doc.save();
      const obj = doc.toObject();
      return { ...obj, id: obj._id.toString() };
    },
    async find(filter: any = {}): Promise<ISimulatedBill[]> {
      if (isMockDatabase) {
        return mockStore.bills.filter(b => {
          return Object.entries(filter).every(([key, val]) => {
            if (val instanceof Date) {
              return (b as any)[key].getTime() === val.getTime();
            }
            return (b as any)[key] === val;
          });
        });
      }
      const docs = await SimulatedBillModel.find(filter);
      return docs.map(d => {
        const obj = d.toObject();
        return { ...obj, id: obj._id.toString() };
      });
    },
    async findById(id: string): Promise<ISimulatedBill | null> {
      if (isMockDatabase) {
        return mockStore.bills.find(b => b.id === id) || null;
      }
      const doc = await SimulatedBillModel.findById(id);
      if (!doc) return null;
      const obj = doc.toObject();
      return { ...obj, id: obj._id.toString() };
    },
    async updateOne(id: string, update: Partial<ISimulatedBill>): Promise<ISimulatedBill | null> {
      if (isMockDatabase) {
        const idx = mockStore.bills.findIndex(b => b.id === id);
        if (idx === -1) return null;
        mockStore.bills[idx] = { ...mockStore.bills[idx], ...update };
        return mockStore.bills[idx];
      }
      const doc = await SimulatedBillModel.findByIdAndUpdate(id, update, { new: true });
      if (!doc) return null;
      const obj = doc.toObject();
      return { ...obj, id: obj._id.toString() };
    }
  }
};

// Seed mock data for mock mode so there's content right away
function seedMockData() {
  console.log('[DB] Seeding default in-memory database data...');
  // We can seed users, accounts, etc. later from the server.ts startup
}

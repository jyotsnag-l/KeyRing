"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.isMockDatabase = void 0;
exports.connectDB = connectDB;
const mongoose_1 = __importStar(require("mongoose"));
// Let's declare our flag for mock database fallback
exports.isMockDatabase = false;
// Dynamic import of MongoMemoryServer to handle setup without crash
let MongoMemoryServer = null;
try {
    MongoMemoryServer = require('mongodb-memory-server').MongoMemoryServer;
}
catch (e) {
    console.warn('[DB SETUP] mongodb-memory-server is not available. Fallback to full mock mode will be used if real mongo fails.');
}
// ----------------------------------------------------
// MONGOOSE SCHEMA DEFINITIONS
// ----------------------------------------------------
const UserSchema = new mongoose_1.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['parent', 'delegate', 'co_signer', 'sibling', 'advisor'], required: true },
    familyId: { type: String, required: true }
});
const GrantSchema = new mongoose_1.Schema({
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
const EscalationRequestSchema = new mongoose_1.Schema({
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
const AuditEventSchema = new mongoose_1.Schema({
    grantId: { type: String, default: null },
    actorId: { type: String, required: true },
    actionType: { type: String, required: true },
    target: { type: String, required: true },
    amount: { type: Number, default: null },
    timestamp: { type: Date, default: Date.now },
    prevEventHash: { type: String, required: true },
    eventHash: { type: String, required: true }
});
const SimulatedAccountSchema = new mongoose_1.Schema({
    familyId: { type: String, required: true },
    institution: { type: String, required: true },
    accountName: { type: String, required: true },
    accountNumber: { type: String, required: true },
    balance: { type: Number, required: true },
    domain: { type: String, enum: ['financial', 'medical', 'household', 'insurance'], required: true }
});
const SimulatedBillSchema = new mongoose_1.Schema({
    familyId: { type: String, required: true },
    payee: { type: String, required: true },
    amount: { type: Number, required: true },
    dueDate: { type: Date, required: true },
    domain: { type: String, enum: ['financial', 'medical', 'household', 'insurance'], required: true },
    status: { type: String, enum: ['pending', 'paid'], default: 'pending' }
});
// Models (will be initialized if mongoose connects successfully)
let UserModel;
let GrantModel;
let EscalationRequestModel;
let AuditEventModel;
let SimulatedAccountModel;
let SimulatedBillModel;
// ----------------------------------------------------
// IN-MEMORY MOCK DATA STORES
// ----------------------------------------------------
const mockStore = {
    users: [],
    grants: [],
    escalations: [],
    auditEvents: [],
    accounts: [],
    bills: []
};
// Helper for generating IDs in mock mode
const generateId = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
// ----------------------------------------------------
// DATABASE INITIALIZATION
// ----------------------------------------------------
async function connectDB() {
    const mongoUri = process.env.MONGO_URI;
    if (mongoUri) {
        try {
            console.log('[DB] Connecting to MongoDB from env...');
            await mongoose_1.default.connect(mongoUri);
            console.log('[DB] Connected to MongoDB successfully.');
            initMongooseModels();
            return;
        }
        catch (err) {
            console.error('[DB] Failed to connect to MONGO_URI. Trying fallback...', err);
        }
    }
    // Try MongoMemoryServer fallback
    if (MongoMemoryServer) {
        try {
            console.log('[DB] Starting MongoDB Memory Server fallback...');
            const mongoServer = await MongoMemoryServer.create();
            const uri = mongoServer.getUri();
            await mongoose_1.default.connect(uri);
            console.log('[DB] Connected to MongoDB Memory Server successfully.');
            initMongooseModels();
            return;
        }
        catch (err) {
            console.error('[DB] Failed to start MongoDB Memory Server. Falling back to clean Mock Memory Database...', err);
        }
    }
    // Fallback to memory array mock
    console.warn('[DB] ---------------------------------------------------------------');
    console.warn('[DB] WARNING: Using fully in-memory mock database array fallback!');
    console.warn('[DB] All data will be lost when the server restarts.');
    console.warn('[DB] ---------------------------------------------------------------');
    exports.isMockDatabase = true;
    seedMockData();
}
function initMongooseModels() {
    UserModel = mongoose_1.default.model('User', UserSchema);
    GrantModel = mongoose_1.default.model('Grant', GrantSchema);
    EscalationRequestModel = mongoose_1.default.model('EscalationRequest', EscalationRequestSchema);
    AuditEventModel = mongoose_1.default.model('AuditEvent', AuditEventSchema);
    SimulatedAccountModel = mongoose_1.default.model('SimulatedAccount', SimulatedAccountSchema);
    SimulatedBillModel = mongoose_1.default.model('SimulatedBill', SimulatedBillSchema);
}
// ----------------------------------------------------
// REPOSITORY IMPLEMENTATIONS
// ----------------------------------------------------
exports.db = {
    users: {
        async create(user) {
            if (exports.isMockDatabase) {
                const newUser = { ...user, _id: generateId() };
                mockStore.users.push(newUser);
                return newUser;
            }
            const doc = new UserModel(user);
            await doc.save();
            return doc.toObject();
        },
        async findOne(filter) {
            if (exports.isMockDatabase) {
                return mockStore.users.find(u => {
                    return Object.entries(filter).every(([key, val]) => u[key] === val);
                }) || null;
            }
            const doc = await UserModel.findOne(filter);
            return doc ? doc.toObject() : null;
        },
        async findById(id) {
            if (exports.isMockDatabase) {
                return mockStore.users.find(u => u._id === id) || null;
            }
            const doc = await UserModel.findById(id);
            return doc ? doc.toObject() : null;
        },
        async find(filter = {}) {
            if (exports.isMockDatabase) {
                return mockStore.users.filter(u => {
                    return Object.entries(filter).every(([key, val]) => u[key] === val);
                });
            }
            const docs = await UserModel.find(filter);
            return docs.map(d => d.toObject());
        }
    },
    grants: {
        async create(grant) {
            if (exports.isMockDatabase) {
                const newGrant = { ...grant, _id: generateId() };
                mockStore.grants.push(newGrant);
                return newGrant;
            }
            const doc = new GrantModel(grant);
            await doc.save();
            return doc.toObject();
        },
        async find(filter = {}) {
            if (exports.isMockDatabase) {
                return mockStore.grants.filter(g => {
                    return Object.entries(filter).every(([key, val]) => {
                        if (val instanceof Date) {
                            return g[key].getTime() === val.getTime();
                        }
                        if (Array.isArray(val)) {
                            return JSON.stringify(g[key]) === JSON.stringify(val);
                        }
                        return g[key] === val;
                    });
                });
            }
            const docs = await GrantModel.find(filter);
            return docs.map(d => d.toObject());
        },
        async findById(id) {
            if (exports.isMockDatabase) {
                return mockStore.grants.find(g => g._id === id) || null;
            }
            const doc = await GrantModel.findById(id);
            return doc ? doc.toObject() : null;
        },
        async updateOne(id, update) {
            if (exports.isMockDatabase) {
                const idx = mockStore.grants.findIndex(g => g._id === id);
                if (idx === -1)
                    return null;
                mockStore.grants[idx] = { ...mockStore.grants[idx], ...update };
                return mockStore.grants[idx];
            }
            const doc = await GrantModel.findByIdAndUpdate(id, update, { new: true });
            return doc ? doc.toObject() : null;
        },
        async findExpired(now) {
            if (exports.isMockDatabase) {
                return mockStore.grants.filter(g => g.status === 'active' && g.expiresAt <= now);
            }
            const docs = await GrantModel.find({ status: 'active', expiresAt: { $lte: now } });
            return docs.map(d => d.toObject());
        }
    },
    escalations: {
        async create(req) {
            if (exports.isMockDatabase) {
                const newReq = { ...req, _id: generateId(), createdAt: new Date() };
                mockStore.escalations.push(newReq);
                return newReq;
            }
            const doc = new EscalationRequestModel(req);
            await doc.save();
            return doc.toObject();
        },
        async findById(id) {
            if (exports.isMockDatabase) {
                return mockStore.escalations.find(e => e._id === id) || null;
            }
            const doc = await EscalationRequestModel.findById(id);
            return doc ? doc.toObject() : null;
        },
        async find(filter = {}) {
            if (exports.isMockDatabase) {
                return mockStore.escalations.filter(e => {
                    return Object.entries(filter).every(([key, val]) => e[key] === val);
                });
            }
            const docs = await EscalationRequestModel.find(filter);
            return docs.map(d => d.toObject());
        },
        async updateOne(id, update) {
            if (exports.isMockDatabase) {
                const idx = mockStore.escalations.findIndex(e => e._id === id);
                if (idx === -1)
                    return null;
                mockStore.escalations[idx] = { ...mockStore.escalations[idx], ...update };
                return mockStore.escalations[idx];
            }
            const doc = await EscalationRequestModel.findByIdAndUpdate(id, update, { new: true });
            return doc ? doc.toObject() : null;
        }
    },
    audit: {
        async create(event) {
            if (exports.isMockDatabase) {
                const newEvent = { ...event, _id: generateId() };
                mockStore.auditEvents.push(newEvent);
                return newEvent;
            }
            const doc = new AuditEventModel(event);
            await doc.save();
            return doc.toObject();
        },
        async find(filter = {}) {
            if (exports.isMockDatabase) {
                return mockStore.auditEvents.filter(e => {
                    return Object.entries(filter).every(([key, val]) => e[key] === val);
                });
            }
            const docs = await AuditEventModel.find(filter).sort({ timestamp: 1 });
            return docs.map(d => d.toObject());
        },
        async findLatest(grantId) {
            if (exports.isMockDatabase) {
                const filtered = grantId
                    ? mockStore.auditEvents.filter(e => e.grantId === grantId)
                    : mockStore.auditEvents;
                if (filtered.length === 0)
                    return null;
                return filtered[filtered.length - 1];
            }
            const query = grantId ? { grantId } : {};
            const doc = await AuditEventModel.findOne(query).sort({ timestamp: -1 });
            return doc ? doc.toObject() : null;
        }
    },
    accounts: {
        async create(acc) {
            if (exports.isMockDatabase) {
                const newAcc = { ...acc, id: generateId() };
                mockStore.accounts.push(newAcc);
                return newAcc;
            }
            const doc = new SimulatedAccountModel(acc);
            await doc.save();
            const obj = doc.toObject();
            return { ...obj, id: obj._id.toString() };
        },
        async find(filter = {}) {
            if (exports.isMockDatabase) {
                return mockStore.accounts.filter(a => {
                    return Object.entries(filter).every(([key, val]) => a[key] === val);
                });
            }
            const docs = await SimulatedAccountModel.find(filter);
            return docs.map(d => {
                const obj = d.toObject();
                return { ...obj, id: obj._id.toString() };
            });
        },
        async findById(id) {
            if (exports.isMockDatabase) {
                return mockStore.accounts.find(a => a.id === id) || null;
            }
            const doc = await SimulatedAccountModel.findById(id);
            if (!doc)
                return null;
            const obj = doc.toObject();
            return { ...obj, id: obj._id.toString() };
        },
        async updateOne(id, update) {
            if (exports.isMockDatabase) {
                const idx = mockStore.accounts.findIndex(a => a.id === id);
                if (idx === -1)
                    return null;
                mockStore.accounts[idx] = { ...mockStore.accounts[idx], ...update };
                return mockStore.accounts[idx];
            }
            const doc = await SimulatedAccountModel.findByIdAndUpdate(id, update, { new: true });
            if (!doc)
                return null;
            const obj = doc.toObject();
            return { ...obj, id: obj._id.toString() };
        }
    },
    bills: {
        async create(bill) {
            if (exports.isMockDatabase) {
                const newBill = { ...bill, id: generateId() };
                mockStore.bills.push(newBill);
                return newBill;
            }
            const doc = new SimulatedBillModel(bill);
            await doc.save();
            const obj = doc.toObject();
            return { ...obj, id: obj._id.toString() };
        },
        async find(filter = {}) {
            if (exports.isMockDatabase) {
                return mockStore.bills.filter(b => {
                    return Object.entries(filter).every(([key, val]) => {
                        if (val instanceof Date) {
                            return b[key].getTime() === val.getTime();
                        }
                        return b[key] === val;
                    });
                });
            }
            const docs = await SimulatedBillModel.find(filter);
            return docs.map(d => {
                const obj = d.toObject();
                return { ...obj, id: obj._id.toString() };
            });
        },
        async findById(id) {
            if (exports.isMockDatabase) {
                return mockStore.bills.find(b => b.id === id) || null;
            }
            const doc = await SimulatedBillModel.findById(id);
            if (!doc)
                return null;
            const obj = doc.toObject();
            return { ...obj, id: obj._id.toString() };
        },
        async updateOne(id, update) {
            if (exports.isMockDatabase) {
                const idx = mockStore.bills.findIndex(b => b.id === id);
                if (idx === -1)
                    return null;
                mockStore.bills[idx] = { ...mockStore.bills[idx], ...update };
                return mockStore.bills[idx];
            }
            const doc = await SimulatedBillModel.findByIdAndUpdate(id, update, { new: true });
            if (!doc)
                return null;
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

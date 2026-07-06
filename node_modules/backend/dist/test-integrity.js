"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("./models/db");
const AgentServices_1 = require("./services/AgentServices");
const crypto_1 = require("./utils/crypto");
async function runTests() {
    console.log('========================================================');
    console.log('        KEYRING CRYPTOGRAPHIC & POLICY INTEGRITY TEST   ');
    console.log('========================================================');
    // 1. Connect to Database (forces mock/in-memory server fallback)
    process.env.MONGO_URI = ''; // Force in-memory memory server or mock
    await (0, db_1.connectDB)();
    console.log('\n[TEST 1] Initializing family and seeding simulated data...');
    const familyId = 'test-family-999';
    const parentEmail = 'jo-parent@test.com';
    const delegateEmail = 'priya-delegate@test.com';
    const users = await AgentServices_1.IntakeAgent.setupFamily(familyId, { name: 'Jo', email: parentEmail, passwordHash: 'hash' }, [
        { name: 'Priya', email: delegateEmail, passwordHash: 'hash', role: 'delegate' },
        { name: 'Sam', email: 'sam@test.com', passwordHash: 'hash', role: 'co_signer' }
    ]);
    const parent = users.find(u => u.role === 'parent');
    const delegate = users.find(u => u.role === 'delegate');
    console.log(`Registered Parent ID: ${parent._id}`);
    console.log(`Registered Delegate ID: ${delegate._id}`);
    // Retrieve seeded checking account and utility bill
    const accounts = await db_1.db.accounts.find({ familyId });
    const checking = accounts.find(a => a.accountName === 'Checking Account');
    const bills = await db_1.db.bills.find({ familyId });
    const smallBill = bills.find(b => b.amount < 200 && b.domain === 'household');
    const largeBill = bills.find(b => b.amount > 1000 && b.domain === 'household');
    console.log(`Checking balance: $${checking.balance}`);
    console.log(`Small Bill (${smallBill.payee}): $${smallBill.amount}`);
    console.log(`Large Bill (${largeBill.payee}): $${largeBill.amount}`);
    // ----------------------------------------------------
    // TEST 2: Guardian Denies Action Without Active Grant
    // ----------------------------------------------------
    console.log('\n[TEST 2] Verifying Guardian denies action without active grant...');
    const resDeniedNoGrant = await AgentServices_1.GuardianAgent.checkAndExecute(delegate._id, {
        type: 'view_balance',
        domain: 'financial',
        targetId: checking.id,
        familyId
    });
    if (resDeniedNoGrant.status === 'denied') {
        console.log('✓ SUCCESS: Guardian blocked balance view without active grant.');
        console.log(`  Reason: "${resDeniedNoGrant.reason}"`);
    }
    else {
        throw new Error('FAIL: Guardian allowed action without active grant.');
    }
    // ----------------------------------------------------
    // TEST 3: Create Scoped Grant & Execute Allowed Action
    // ----------------------------------------------------
    console.log('\n[TEST 3] Creating scoped grant and executing allowed action...');
    const startAt = new Date();
    const expiresAt = new Date(Date.now() + 100000); // 100 seconds in future
    const grant = await AgentServices_1.GrantAgent.createGrant({
        parentId: parent._id,
        delegateId: delegate._id,
        scope: 'pay_bills',
        domain: 'household',
        reason: 'Temporary helper grant',
        createdBy: parent._id,
        startAt,
        expiresAt,
        coSigners: [],
        parentAck: true,
        transactionCap: 500, // $500 cap
        monthlyCap: 2000
    });
    console.log(`Active Grant Created: ID ${grant._id}, Scope: ${grant.scope}, Domain: ${grant.domain}, Cap: $${grant.transactionCap}`);
    // Execute small bill pay (under cap)
    const resSmallBillPay = await AgentServices_1.GuardianAgent.checkAndExecute(delegate._id, {
        type: 'pay_bill',
        domain: 'household',
        targetId: smallBill.id,
        amount: smallBill.amount,
        familyId
    });
    if (resSmallBillPay.status === 'approved') {
        console.log(`✓ SUCCESS: Guardian approved bill pay of $${smallBill.amount}.`);
        const updatedChecking = await db_1.db.accounts.findById(checking.id);
        console.log(`  New checking balance: $${updatedChecking?.balance}`);
    }
    else {
        throw new Error(`FAIL: Guardian blocked valid bill payment. Reason: ${resSmallBillPay.reason}`);
    }
    // ----------------------------------------------------
    // TEST 4: Guardian Denies Action Exceeding Single Cap
    // ----------------------------------------------------
    console.log('\n[TEST 4] Verifying Guardian blocks transaction exceeding single limit...');
    const resLargeBillPay = await AgentServices_1.GuardianAgent.checkAndExecute(delegate._id, {
        type: 'pay_bill',
        domain: 'household',
        targetId: largeBill.id,
        amount: largeBill.amount,
        familyId
    });
    if (resLargeBillPay.status === 'denied') {
        console.log('✓ SUCCESS: Guardian blocked payment exceeding transaction limit.');
        console.log(`  Reason: "${resLargeBillPay.reason}"`);
    }
    else {
        throw new Error('FAIL: Guardian allowed payment exceeding limit.');
    }
    // ----------------------------------------------------
    // TEST 5: Cryptographic Chain Verification
    // ----------------------------------------------------
    console.log('\n[TEST 5] Verifying integrity of global audit trail chain...');
    const checkInitial = await (0, crypto_1.verifyAuditChain)();
    if (checkInitial.valid) {
        console.log('✓ SUCCESS: Audit logs cryptographically verified and linked.');
    }
    else {
        throw new Error('FAIL: Initial audit log chain is invalid.');
    }
    // ----------------------------------------------------
    // TEST 6: Tampering Detection
    // ----------------------------------------------------
    console.log('\n[TEST 6] Simulating database tampering and verifying chain detection...');
    const logs = await db_1.db.audit.find({});
    if (logs.length < 2) {
        throw new Error('Not enough logs generated to run tampering test');
    }
    // Let's modify a log entry in the middle of the chain directly (bypassing the crypto code)
    const targetLog = logs[1];
    console.log(`  Original Event [#2]: Action=${targetLog.actionType}, Target="${targetLog.target}"`);
    // Direct mock store modification or Mongoose updates
    if (db_1.isMockDatabase) {
        // Modify in-memory array
        targetLog.target = 'TAMPERED: Transferred $1,000,000 to Switzerland';
    }
    else {
        // Modify database entry via direct mongodb driver or mongoose bypass
        const mongooseModel = db_1.db.audit.UserModel || (mongooseModel => {
            const conn = require('mongoose');
            return conn.model('AuditEvent');
        })();
        await mongooseModel.findByIdAndUpdate(targetLog._id, { target: 'TAMPERED: Transferred $1,000,000 to Switzerland' });
    }
    console.log(`  Modified Event [#2] in database to: "TAMPERED: Transferred $1,000,000 to Switzerland"`);
    // Run validation
    const checkTampered = await (0, crypto_1.verifyAuditChain)();
    if (!checkTampered.valid) {
        console.log('✓ SUCCESS: Tamper Guard successfully flagged tampering!');
        console.log(`  Detection broke at chain index: ${checkTampered.brokenIndex}`);
    }
    else {
        throw new Error('FAIL: Tamper Guard did not detect audit chain modification.');
    }
    console.log('\n========================================================');
    console.log('               ALL TESTS PASSED SUCCESSFULLY!           ');
    console.log('========================================================');
    process.exit(0);
}
runTests().catch(err => {
    console.error('\n!!! TEST RUN FAILED !!!');
    console.error(err);
    process.exit(1);
});

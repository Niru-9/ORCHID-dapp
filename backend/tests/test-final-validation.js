/**
 * FINAL VALIDATION — ABANDONMENT + RESOLUTION SYSTEM
 * 
 * PRECONDITION: Clean state (run reset-test-data.js first)
 * GOAL: Validate system guarantees under all scenarios
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BACKEND_URL = 'http://localhost:5000';

// Real Stellar testnet addresses (funded)
const USER_TEST1 = 'GACEXZXJV22DBLDNSEXW44OOGYDQVYJH6QFSFZONCBONNCK43H6P6TJC';
const USER_TEST2 = 'GCJCDMSB4M4ALXUFCF4IOH4QOKV753EIYDNZHIXD5LGQIVRGX5WDE4B3';
const USER_TEST3 = 'GCUQD5FOYAAMZNESAA23TKZZPE5AZ5I6UV2NHNSFPGOYZVES25CIXUD4';
const USER_TEST4 = 'GCO5X4EGVLTRWHACJTAK7MGBLU5ESPPPL2TIKTCW3K46CHMR6D2TRHU5';
const USER_TEST5A = 'GB5H543PS7TOOQPHIOWRHRIJYUKRHOS46AIUORJCCYURTGJDRGVD5LNH';
const USER_TEST5B = 'GCMEKTHZ5KUJ4A5NVOH26PXRW72QQS5FHVSQCXIGPSNWIBGKYBHRO2SW';
const USER_TEST5C = 'GCHP3QYRDEJ7GORWGZ54TTUCYS3CTH7QJ6MU5GVSJHII366ICXMTORWK';
const USER_TEST5D = 'GDMZRVCD6TEOQJFZGM7NHYNT37Q2OQE4QGSBGDSDZOSBOAZB22WR3TZ7';
const USER_TEST5E = 'GA44BFZJVZH6Q2ECUY5QWB5YA6LHJ4IZFNWR7MPPQ54JN7SOWAL7E3XW';

let testResults = [];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function logTest(name, status, details) {
  const result = { test: name, status, details, timestamp: new Date().toISOString() };
  testResults.push(result);
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${icon} ${name}: ${status}`);
  if (details) console.log(`   ${details}`);
}

async function getUserStats(address) {
  return fetch(`${BACKEND_URL}/api/user-stats/${address}`).then(r => r.json());
}

async function signalIntent(address, escrowId) {
  return fetch(`${BACKEND_URL}/api/intent/${escrowId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      caller: address,
      is_arbiter: false,
      reward_stroops: 5000000,
      caller_balance: 100000000,
      stake_amount: 1000000000,
      escrow_arbitrators: [],
    }),
  }).then(r => r.json());
}

async function markResolved(address, escrowId) {
  return fetch(`${BACKEND_URL}/api/intent/${escrowId}/executed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      caller: address,
      success: true,
    }),
  }).then(r => r.json());
}

async function checkEscrowResolved(escrowId) {
  return fetch(`${BACKEND_URL}/api/debug/escrow-resolved/${escrowId}`).then(r => r.json());
}

// ----------------------------------
// TEST 1 — BASIC ABANDONMENT
// ----------------------------------
async function test1_BasicAbandonment() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  TEST 1: BASIC ABANDONMENT                                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  const address = USER_TEST1;
  const escrowId = 20001;
  
  const before = await getUserStats(address);
  console.log(`Before: bond_lost=${before.bond_lost || 0}, abandoned=${before.abandoned_intents || 0}`);
  
  const intent = await signalIntent(address, escrowId);
  console.log(`Intent signaled: ${intent.success ? 'SUCCESS' : 'FAILED'}`);
  
  if (!intent.success) {
    logTest('TEST 1', 'FAIL', 'Failed to signal intent');
    return;
  }
  
  console.log('Waiting 30 seconds for abandonment...');
  await sleep(30000);
  
  const after = await getUserStats(address);
  console.log(`After: bond_lost=${after.bond_lost || 0}, abandoned=${after.abandoned_intents || 0}`);
  
  const bondIncreased = (after.bond_lost || 0) === (before.bond_lost || 0) + 1;
  const abandonedIncreased = (after.abandoned_intents || 0) === (before.abandoned_intents || 0) + 1;
  
  if (bondIncreased && abandonedIncreased) {
    logTest('TEST 1', 'PASS', `bond_lost +1 (${before.bond_lost || 0} → ${after.bond_lost || 0}), abandoned_intents +1`);
  } else {
    logTest('TEST 1', 'FAIL', `Expected both +1, got bond_lost: ${before.bond_lost || 0} → ${after.bond_lost || 0}, abandoned: ${before.abandoned_intents || 0} → ${after.abandoned_intents || 0}`);
  }
}

// ----------------------------------
// TEST 2 — RESOLVE BEFORE TTL (CRITICAL)
// ----------------------------------
async function test2_ResolveBeforeTTL() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  TEST 2: RESOLVE BEFORE TTL (CRITICAL)                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  const address = USER_TEST2;
  const escrowId = 20002;
  
  const before = await getUserStats(address);
  console.log(`Before: bond_lost=${before.bond_lost || 0}`);
  
  const intent = await signalIntent(address, escrowId);
  console.log(`Intent signaled: ${intent.success ? 'SUCCESS' : 'FAILED'}`);
  
  if (!intent.success) {
    logTest('TEST 2', 'FAIL', 'Failed to signal intent');
    return;
  }
  
  console.log('Waiting 5 seconds, then resolving...');
  await sleep(5000);
  
  const resolved = await markResolved(address, escrowId);
  console.log(`Resolved: ${resolved.success ? 'SUCCESS' : 'FAILED'}`);
  
  // Check escrow resolved state
  const escrowState = await checkEscrowResolved(escrowId);
  console.log(`Escrow resolved state: ${escrowState.is_resolved ? 'EXISTS' : 'MISSING'}`);
  
  console.log('Waiting 30 seconds to ensure no penalty...');
  await sleep(30000);
  
  const after = await getUserStats(address);
  console.log(`After: bond_lost=${after.bond_lost || 0}`);
  
  const beforeBond = before.bond_lost || 0;
  const afterBond = after.bond_lost || 0;
  const expectedBond = Math.max(0, beforeBond - 1); // Reward
  
  const correct = afterBond === expectedBond && escrowState.is_resolved;
  
  if (correct) {
    logTest('TEST 2', 'PASS', `No penalty - bond_lost reward: ${beforeBond} → ${afterBond}, escrow_resolved exists`);
  } else {
    logTest('TEST 2', 'FAIL', `bond_lost: ${beforeBond} → ${afterBond} (expected ${expectedBond}), escrow_resolved: ${escrowState.is_resolved}`);
  }
}

// ----------------------------------
// TEST 3 — TTL EDGE CASE
// ----------------------------------
async function test3_TTLEdgeCase() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  TEST 3: TTL EDGE CASE (RESOLVE AT BOUNDARY)              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  const address = USER_TEST3;
  const escrowId = 20003;
  
  const before = await getUserStats(address);
  console.log(`Before: bond_lost=${before.bond_lost || 0}`);
  
  const intent = await signalIntent(address, escrowId);
  console.log(`Intent signaled: ${intent.success ? 'SUCCESS' : 'FAILED'}`);
  
  if (!intent.success) {
    logTest('TEST 3', 'FAIL', 'Failed to signal intent');
    return;
  }
  
  console.log('Waiting 12 seconds (TTL boundary), then resolving...');
  await sleep(12000);
  
  const resolved = await markResolved(address, escrowId);
  console.log(`Resolved: ${resolved.success ? 'SUCCESS' : 'FAILED'}`);
  
  console.log('Waiting 20 seconds to check for penalty...');
  await sleep(20000);
  
  const after = await getUserStats(address);
  console.log(`After: bond_lost=${after.bond_lost || 0}`);
  
  const beforeBond = before.bond_lost || 0;
  const afterBond = after.bond_lost || 0;
  const expectedBond = Math.max(0, beforeBond - 1); // Reward
  
  if (afterBond === expectedBond) {
    logTest('TEST 3', 'PASS', `No penalty at boundary - bond_lost reward: ${beforeBond} → ${afterBond}`);
  } else {
    logTest('TEST 3', 'FAIL', `bond_lost: ${beforeBond} → ${afterBond} (expected ${expectedBond})`);
  }
}

// ----------------------------------
// TEST 4 — DUPLICATE PROCESSOR SAFETY
// ----------------------------------
async function test4_DuplicateProcessing() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  TEST 4: DUPLICATE PROCESSOR SAFETY                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  const address = USER_TEST4;
  const escrowId = 20004;
  
  const before = await getUserStats(address);
  console.log(`Before: bond_lost=${before.bond_lost || 0}`);
  
  const intent = await signalIntent(address, escrowId);
  console.log(`Intent signaled: ${intent.success ? 'SUCCESS' : 'FAILED'}`);
  
  if (!intent.success) {
    logTest('TEST 4', 'FAIL', 'Failed to signal intent');
    return;
  }
  
  console.log('Waiting 40 seconds for TWO processor cycles...');
  await sleep(40000);
  
  const after = await getUserStats(address);
  console.log(`After: bond_lost=${after.bond_lost || 0}`);
  
  const exactlyOne = (after.bond_lost || 0) === (before.bond_lost || 0) + 1;
  
  if (exactlyOne) {
    logTest('TEST 4', 'PASS', `Only ONE penalty: ${before.bond_lost || 0} → ${after.bond_lost || 0}`);
  } else {
    logTest('TEST 4', 'FAIL', `Expected +1, got ${before.bond_lost || 0} → ${after.bond_lost || 0}`);
  }
}

// ----------------------------------
// TEST 5 — MULTI-USER ISOLATION (FINAL BOSS)
// ----------------------------------
async function test5_MultiUserIsolation() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  TEST 5: MULTI-USER ISOLATION (FINAL BOSS)                ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  const users = [
    { addr: USER_TEST5A, escrow: 20005, shouldAbandon: true, name: 'User A' },
    { addr: USER_TEST5B, escrow: 20006, shouldAbandon: false, name: 'User B' },
    { addr: USER_TEST5C, escrow: 20007, shouldAbandon: true, name: 'User C' },
    { addr: USER_TEST5D, escrow: 20008, shouldAbandon: false, name: 'User D' },
    { addr: USER_TEST5E, escrow: 20009, shouldAbandon: true, name: 'User E' },
  ];
  
  // Get initial stats
  const beforeStats = {};
  for (const user of users) {
    const stats = await getUserStats(user.addr);
    beforeStats[user.name] = stats.bond_lost || 0;
    console.log(`${user.name} before: bond_lost=${beforeStats[user.name]}`);
  }
  
  // Signal all intents
  console.log('\nSignaling intents for all users...');
  for (const user of users) {
    const intent = await signalIntent(user.addr, user.escrow);
    console.log(`${user.name}: ${intent.success ? 'SUCCESS' : 'FAILED'}`);
    if (!intent.success) {
      logTest('TEST 5', 'FAIL', `${user.name} failed to signal intent`);
      return;
    }
  }
  
  // Resolve for non-abandon users (B and D)
  console.log('\nResolving for Users B and D...');
  await sleep(5000);
  await markResolved(USER_TEST5B, 20006);
  await markResolved(USER_TEST5D, 20008);
  console.log('Resolved');
  
  // Wait for processor
  console.log('\nWaiting 30 seconds for processor...');
  await sleep(30000);
  
  // Check all stats
  console.log('\nChecking final stats...');
  let allCorrect = true;
  const results = {};
  
  for (const user of users) {
    const stats = await getUserStats(user.addr);
    const after = stats.bond_lost || 0;
    const before = beforeStats[user.name];
    
    let expected;
    let correct;
    
    if (user.shouldAbandon) {
      // Abandoned users: +1 penalty
      expected = before + 1;
      correct = after === expected;
      console.log(`${user.name}: ${before} → ${after} (expected ${expected} - abandoned) ${correct ? '✅' : '❌'}`);
    } else {
      // Resolved users: -1 reward (or stay at 0)
      expected = Math.max(0, before - 1);
      correct = after === expected;
      console.log(`${user.name}: ${before} → ${after} (expected ${expected} - resolved) ${correct ? '✅' : '❌'}`);
    }
    
    results[user.name] = { before, after, expected, correct };
    if (!correct) allCorrect = false;
  }
  
  if (allCorrect) {
    logTest('TEST 5', 'PASS', 'All users correctly isolated - A,C,E penalized (+1), B,D rewarded (-1)');
  } else {
    const failures = Object.entries(results).filter(([_, r]) => !r.correct).map(([name, r]) => `${name}: ${r.before}→${r.after} (expected ${r.expected})`).join(', ');
    logTest('TEST 5', 'FAIL', `Incorrect changes: ${failures}`);
  }
}

// ----------------------------------
// MAIN TEST RUNNER
// ----------------------------------
async function runFinalValidation() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║     FINAL VALIDATION — ABANDONMENT + RESOLUTION            ║');
  console.log('║     PRECONDITION: Clean state (reset-test-data.js)         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  const startTime = Date.now();
  
  try {
    await test1_BasicAbandonment();
    await test2_ResolveBeforeTTL();
    await test3_TTLEdgeCase();
    await test4_DuplicateProcessing();
    await test5_MultiUserIsolation();
    
  } catch (error) {
    console.error('\n❌ CRITICAL ERROR:', error);
    logTest('SYSTEM', 'FAIL', `Critical error: ${error.message}`);
  }
  
  const duration = Math.round((Date.now() - startTime) / 1000);
  
  // Final summary
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    FINAL VERDICT                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  const passed = testResults.filter(r => r.status === 'PASS').length;
  const failed = testResults.filter(r => r.status === 'FAIL').length;
  const total = testResults.length;
  
  console.log(`Tests Run: ${total}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Duration: ${duration}s\n`);
  
  testResults.forEach(r => {
    const icon = r.status === 'PASS' ? '✅' : '❌';
    console.log(`${icon} ${r.test}`);
    if (r.details) console.log(`   ${r.details}`);
  });
  
  console.log('\n');
  
  if (failed === 0) {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║  ✅ SYSTEM = SAFE                                          ║');
    console.log('║     All validation tests passed                            ║');
    console.log('║     System guarantees:                                     ║');
    console.log('║     • IF resolved → NEVER penalize                         ║');
    console.log('║     • IF not resolved + TTL expired → ALWAYS penalize      ║');
    console.log('║     • Multi-user isolation working correctly               ║');
    console.log('║     • Production-ready ✅                                  ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
  } else {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║  ❌ SYSTEM = UNSAFE                                        ║');
    console.log('║     Critical issues detected                               ║');
    console.log('║     DO NOT deploy to production                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
  }
}

runFinalValidation().catch(console.error);

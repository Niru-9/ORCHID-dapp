/**
 * Orchid Escrow Contract Client
 * ──────────────────────────────
 * All escrow logic lives on-chain in the deployed Soroban smart contract.
 * This file is the frontend bridge — it builds, simulates, signs, and submits
 * transactions to the contract on behalf of the connected wallet.
 *
 * Contract ID: set via VITE_ESCROW_CONTRACT_ID in .env
 *
 * Two escrow modes:
 *   Mode A (useArbitration = false) — trust-minimized, no dispute path.
 *                                     Buyer + seller settle directly.
 *   Mode B (useArbitration = true)  — contract auto-assigns an arbiter panel
 *                                     from the registered staked arbiter pool.
 *
 * Contract functions exposed here:
 *   create_escrow   → lock funds into the contract
 *   mark_delivered  → seller signals goods/service delivered
 *   confirm_delivery→ buyer confirms, releases funds to seller
 *   cancel          → buyer cancels before deadline, gets refund
 *   dispute         → either party raises a dispute (Mode B only)
 *   vote            → arbiter casts Release or Refund vote
 *   resolve_dispute → anyone executes the majority vote outcome
 *   auto_release    → anyone triggers release after deadline passes
 *   register_arbiter→ stake XLM to join the arbiter pool
 */

import {
  rpc as SorobanRpc,
  TransactionBuilder,
  Networks,
  nativeToScVal,
  Address,
  Operation,
  xdr,
  scValToNative,
} from '@stellar/stellar-sdk';
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit/sdk';

const RPC_URL      = import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const CONTRACT_ID  = import.meta.env.VITE_ESCROW_CONTRACT_ID;
const NETWORK_PASS = Networks.TESTNET;
const BACKEND_URL  = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:5000';
const BASE_FEE     = '300000'; // 0.03 XLM — covers Soroban compute fees

// Native XLM token contract address on Stellar testnet
const NATIVE_TOKEN  = import.meta.env.VITE_NATIVE_TOKEN  || 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

// A funded account used for read-only simulations (no signing needed)
const DUMMY_ACCOUNT = import.meta.env.VITE_ADMIN_ADDRESS  || 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';

// Initialize the Soroban RPC connection
let rpcServer;
try {
  rpcServer = new SorobanRpc.Server(RPC_URL);
} catch (e) {
  rpcServer = null;
}

// ── Value Encoding Helpers ────────────────────────────────────────────────────
// Soroban contracts use typed XDR values — these helpers convert JS types.

/** Converts a Stellar address string (G...) into a Soroban ScVal. */
function addressVal(addr) { return new Address(addr).toScVal(); }

/** Converts a JS number into a Soroban u64 ScVal (used for IDs, timestamps). */
function u64Val(n)        { return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(n))); }

/**
 * Converts an XLM amount (e.g. "10.5") into a Soroban i128 ScVal in stroops.
 * 1 XLM = 10,000,000 stroops (7 decimal places).
 */
function i128Val(xlm) {
  const stroops = BigInt(Math.round(parseFloat(xlm) * 1e7));
  return nativeToScVal(stroops, { type: 'i128' });
}

// ── Core Transaction Engine ───────────────────────────────────────────────────

/**
 * invokeContract — builds, simulates, signs, and submits a state-changing
 * contract call. This is used for all write operations (create, fund, vote, etc.)
 *
 * Flow:
 *  1. Load caller's account sequence number from RPC
 *  2. Build the transaction with the contract call operation
 *  3. Simulate to get the resource footprint (required by Soroban)
 *  4. Assemble the final transaction with simulation data
 *  5. Ask the connected wallet to sign it
 *  6. Submit to the network and poll until confirmed
 *
 * Returns { hash, result } on success. Throws on any failure.
 */
async function invokeContract(callerAddress, method, args) {
  if (!CONTRACT_ID) throw new Error('VITE_ESCROW_CONTRACT_ID not set');

  const account = await rpcServer.getAccount(callerAddress);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASS,
  })
    .addOperation(Operation.invokeContractFunction({
      contract: CONTRACT_ID,
      function: method,
      args,
    }))
    .setTimeout(60)
    .build();

  // Simulate first — Soroban requires this to compute resource fees
  const simResult = await rpcServer.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult))
    throw new Error(`Simulation failed: ${simResult.error}`);

  // Assemble adds the auth entries and resource limits from simulation
  const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
  const xdrStr = assembled.toXDR();

  // Ask the wallet (Freighter / WalletConnect) to sign
  const result = await StellarWalletsKit.signTransaction(xdrStr, {
    networkPassphrase: NETWORK_PASS,
    address: callerAddress,
  });
  const signedXdr = typeof result === 'string' ? result : result?.signedTxXdr ?? result?.xdr;
  if (!signedXdr) throw new Error('Signing cancelled');

  // Submit the signed transaction to the Soroban RPC
  const sendResult = await rpcServer.sendTransaction(
    TransactionBuilder.fromXDR(signedXdr, NETWORK_PASS)
  );
  if (sendResult.status === 'ERROR')
    throw new Error(`Submit failed: ${sendResult.errorResult?.toXDR('base64')}`);

  // Poll every 2 seconds until the transaction is confirmed (max 60s)
  const hash = sendResult.hash;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status = await rpcServer.getTransaction(hash);
    if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS)
      return { hash, result: status.returnValue };
    if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED)
      throw new Error(`Contract call failed: ${hash}`);
  }
  throw new Error('Transaction confirmation timeout');
}

/**
 * readOnly — simulates a read-only contract call without signing.
 * Used for all view functions (get_escrow, escrow_count, etc.)
 * Uses DUMMY_ACCOUNT so no wallet connection is needed to read data.
 * Returns the decoded native JS value, or null on failure.
 */
async function readOnly(method, args) {
  if (!CONTRACT_ID) return null;
  try {
    const account = await rpcServer.getAccount(DUMMY_ACCOUNT);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE, networkPassphrase: NETWORK_PASS,
    })
      .addOperation(Operation.invokeContractFunction({
        contract: CONTRACT_ID, function: method, args,
      }))
      .setTimeout(60)
      .build();
    const sim = await rpcServer.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationSuccess(sim) && sim.result?.retval)
      return scValToNative(sim.result.retval);
  } catch { /* silent — read failures are non-critical */ }
  return null;
}

// ── Escrow Write Functions ────────────────────────────────────────────────────

/**
 * contractCreateEscrow — creates a new escrow and locks the buyer's funds.
 *
 * Mode A (useArbitration = false): simple 2-party escrow, no dispute path.
 * Mode B (useArbitration = true):  contract assigns a 3/5/7 arbiter panel
 *                                  based on the amount. Users cannot pick arbiters.
 *
 * @param buyerAddress   - wallet address of the buyer (pays)
 * @param sellerAddress  - wallet address of the seller (receives)
 * @param amountXlm      - amount to lock in XLM (e.g. "50")
 * @param expiryDays     - how many days until the escrow auto-expires
 * @param useArbitration - false = Mode A, true = Mode B
 * @returns { escrow_id, hash }
 */
export async function contractCreateEscrow(
  buyerAddress,
  sellerAddress,
  amountXlm,
  expiryDays,
  useArbitration = false
) {
  const now      = Math.floor(Date.now() / 1000);
  const deadline = now + parseInt(expiryDays) * 86400;
  const deliveryWindowSecs = 3 * 86400; // 3-day window for seller to mark delivered

  const createResult = await invokeContract(buyerAddress, 'create_escrow', [
    addressVal(buyerAddress),
    addressVal(sellerAddress),
    addressVal(NATIVE_TOKEN),
    i128Val(amountXlm),
    u64Val(deadline),
    u64Val(deliveryWindowSecs),
    xdr.ScVal.scvBool(useArbitration),
  ]);

  const escrowId = scValToNative(createResult.result);
  return { escrow_id: escrowId, hash: createResult.hash };
}

/**
 * contractMarkDelivered — seller calls this to signal delivery is complete.
 * Must be called before the buyer can confirm and release funds.
 */
export async function contractMarkDelivered(sellerAddress, escrowId) {
  return invokeContract(sellerAddress, 'mark_delivered', [
    u64Val(escrowId),
    addressVal(sellerAddress),
  ]);
}

/**
 * contractConfirmDelivery — buyer confirms they received the goods/service.
 * Immediately releases the locked funds to the seller.
 * Requires the escrow to be in "Delivered" state first.
 */
export async function contractConfirmDelivery(buyerAddress, escrowId) {
  return invokeContract(buyerAddress, 'confirm_delivery', [
    u64Val(escrowId),
    addressVal(buyerAddress),
  ]);
}

/**
 * contractCancel — buyer cancels the escrow before the deadline.
 * Refunds the full locked amount back to the buyer.
 */
export async function contractCancel(buyerAddress, escrowId) {
  return invokeContract(buyerAddress, 'cancel', [
    u64Val(escrowId),
    addressVal(buyerAddress),
  ]);
}

/**
 * contractDispute — either party raises a formal dispute.
 * Only available in Mode B (arbitration enabled) escrows.
 * Triggers the arbiter panel voting process.
 */
export async function contractDispute(callerAddress, escrowId) {
  return invokeContract(callerAddress, 'dispute', [
    u64Val(escrowId),
    addressVal(callerAddress),
  ]);
}

/**
 * contractVote — an assigned arbiter casts their vote on a disputed escrow.
 * @param decision - 'Release' (pay seller) or 'Refund' (return to buyer)
 * Majority vote wins. Minority voters get their stake slashed.
 */
export async function contractVote(arbitratorAddress, escrowId, decision) {
  // Soroban enum variant encoded as a single-element vec with a symbol
  const decisionVal = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol(decision === 'Release' ? 'Release' : 'Refund'),
  ]);

  return invokeContract(arbitratorAddress, 'vote', [
    u64Val(escrowId),
    addressVal(arbitratorAddress),
    decisionVal,
  ]);
}

/**
 * contractRefundAfterDeadline — buyer reclaims funds if the seller never
 * marked delivery and the deadline has passed.
 * Permissionless — anyone can call this, funds always go to the buyer.
 */
export async function contractRefundAfterDeadline(callerAddress, escrowId) {
  return invokeContract(callerAddress, 'refund_after_deadline', [
    u64Val(escrowId),
  ]);
}

/**
 * contractRegisterArbiterWithStake — stake XLM to join the arbiter registry.
 * Staked arbiters are eligible to be assigned to Mode B escrow disputes.
 * @param stakeXlm - amount to stake in XLM (e.g. "0.1")
 */
export async function contractRegisterArbiterWithStake(arbiterAddress, stakeXlm) {
  return invokeContract(arbiterAddress, 'register_arbiter', [
    addressVal(arbiterAddress),
    i128Val(stakeXlm),
  ]);
}

/**
 * contractAutoRelease — anyone can call this after the escrow deadline passes.
 * Releases funds to the seller if delivery was confirmed, or refunds buyer otherwise.
 */
export async function contractAutoRelease(callerAddress, escrowId) {
  return invokeContract(callerAddress, 'auto_release', [
    u64Val(escrowId),
  ]);
}

/**
 * contractAutoReleaseAfterDelivery — releases funds if the buyer goes silent
 * after the seller marked delivery. Protects sellers from buyer abandonment.
 */
export async function contractAutoReleaseAfterDelivery(callerAddress, escrowId) {
  return invokeContract(callerAddress, 'auto_release_after_delivery', [
    u64Val(escrowId),
  ]);
}

// ── Legacy Aliases ────────────────────────────────────────────────────────────
// Kept for backward compatibility with older UI code.

/** Alias: request_refund → cancel (buyer cancels before delivery) */
export async function contractRequestRefund(buyerAddress, escrowId) {
  return contractCancel(buyerAddress, escrowId);
}

/** Alias: approve_refund → cancel */
export async function contractApproveRefund(buyerAddress, escrowId) {
  return contractCancel(buyerAddress, escrowId);
}

// ── Read-only View Functions ──────────────────────────────────────────────────
// These simulate contract calls without signing — free to call, no gas cost.

/** Get full details of a single escrow by its on-chain ID. */
export async function contractGetEscrow(escrowId) {
  return readOnly('get_escrow', [u64Val(escrowId)]);
}

/** Get the total number of escrows ever created on this contract. */
export async function contractEscrowCount() {
  const result = await readOnly('escrow_count', []);
  return result ?? 0;
}

/** Get the current platform fee in basis points (100 bps = 1%). */
export async function contractGetFeeBps() {
  return readOnly('get_fee_bps', []);
}

/** Get the current vote tally for a disputed escrow. */
export async function contractGetVotes(escrowId) {
  return readOnly('get_votes', [u64Val(escrowId)]);
}

/** Check if an escrow is Mode B (arbitration enabled). */
export async function contractIsModeB(escrowId) {
  return readOnly('is_mode_b', [u64Val(escrowId)]);
}

/**
 * contractGetPanelSize — returns the arbiter panel size (3, 5, or 7)
 * that would be assigned for a given escrow amount.
 * Higher amounts get larger panels for more robust dispute resolution.
 */
export async function contractGetPanelSize(amountXlm) {
  const stroops = BigInt(Math.round(parseFloat(amountXlm) * 1e7));
  return readOnly('get_panel_size', [nativeToScVal(stroops, { type: 'i128' })]);
}

/** Get the count of currently staked (eligible) arbiters in the pool. */
export async function contractGetEligibleArbiterCount() {
  return readOnly('get_eligible_arbiter_count', []);
}

/**
 * contractResolveDispute — executes the final dispute outcome in one atomic call.
 * Slashes minority voters, rewards the caller for executing, and transfers funds.
 * Caller earns a reward: max(0.05 XLM, 5% of the fee/slash pool).
 */
export async function contractResolveDispute(callerAddress, escrowId) {
  return invokeContract(callerAddress, 'resolve_dispute', [
    addressVal(callerAddress),
    u64Val(escrowId),
  ]);
}

/**
 * contractGetResolutionSummary — get the outcome of a resolved dispute.
 * Returns: { outcome, resolver, resolver_reward, total_pool, total_slashed, resolved_at }
 * Returns null if the dispute hasn't been resolved yet.
 */
export async function contractGetResolutionSummary(escrowId) {
  return readOnly('get_resolution_summary', [u64Val(escrowId)]);
}

/** Request to unstake — starts a 7-day cooldown before tokens can be claimed. */
export async function contractRequestUnstake(arbiterAddress) {
  return invokeContract(arbiterAddress, 'request_unstake', [addressVal(arbiterAddress)]);
}

/** Claim unstaked tokens after the 7-day cooldown has passed. */
export async function contractClaimUnstake(arbiterAddress) {
  return invokeContract(arbiterAddress, 'claim_unstake', [addressVal(arbiterAddress)]);
}

/** Get an arbiter's participation stats: [total_assigned, missed_votes]. */
export async function contractGetArbiterStats(arbiterAddress) {
  return readOnly('get_arbiter_stats', [addressVal(arbiterAddress)]);
}

/** Get the timestamp when an arbiter's unstake cooldown ends (0 = no pending request). */
export async function contractGetUnstakeAt(arbiterAddress) {
  return readOnly('get_unstake_at', [addressVal(arbiterAddress)]);
}

/** Get the accumulated dispute fee pool for a specific escrow. */
export async function contractGetDisputeFeePool(escrowId) {
  return readOnly('get_dispute_fee_pool', [u64Val(escrowId)]);
}

/** Get dispute spike status: [count, window_start]. Used to detect unusual dispute volume. */
export async function contractGetDisputeSpikeStatus() {
  return readOnly('get_dispute_spike_status', []);
}

/** System health snapshot: [pool_size, eligible_count, dispute_count, is_paused]. */
export async function contractGetSystemHealth() {
  return readOnly('get_system_health', []);
}

/**
 * contractGetEscrowsPaginated — fetch a page of escrows by ID range.
 * @param startId   - first escrow ID to fetch (1-based)
 * @param pageSize  - how many to fetch (max 50)
 */
export async function contractGetEscrowsPaginated(startId, pageSize = 50) {
  return readOnly('get_escrows_paginated', [
    u64Val(startId),
    u64Val(Math.min(pageSize, 50)),
  ]);
}

/** Get an arbiter's reputation score (based on voting accuracy history). */
export async function contractGetArbiterReputation(arbiterAddress) {
  return readOnly('get_arbiter_reputation', [addressVal(arbiterAddress)]);
}

/** Get the number of times an arbiter voted with the minority (wrong side). */
export async function contractGetArbiterMinorityVotes(arbiterAddress) {
  return readOnly('get_arbiter_minority_votes', [addressVal(arbiterAddress)]);
}

/** Get the escrow ID of the last dispute this arbiter was assigned to. */
export async function contractGetArbiterLastSelected(arbiterAddress) {
  return readOnly('get_arbiter_last_selected', [addressVal(arbiterAddress)]);
}

/** Get the role of a user in a specific escrow: 'Buyer', 'Seller', or 'Arbiter'. */
export async function contractGetRole(userAddress, escrowId) {
  return readOnly('get_role', [addressVal(userAddress), u64Val(escrowId)]);
}

/** Get all escrow IDs where this address is buyer or seller. */
export async function contractGetUserEscrows(userAddress) {
  return readOnly('get_user_escrows', [addressVal(userAddress)]);
}

/**
 * contractGetActiveEscrows — fetches the most recent 50 active escrows.
 * Uses paginated contract call to avoid scanning the full escrow list.
 */
export async function contractGetActiveEscrows() {
  if (!CONTRACT_ID) return [];
  try {
    const total = await readOnly('escrow_count', []);
    if (!total || total === 0) return [];
    const count = Number(total);
    const startId = Math.max(1, count - 49); // last 50
    const result = await readOnly('get_active_escrows_paginated', [
      u64Val(startId),
      u64Val(50),
    ]);
    return result ?? [];
  } catch { return []; }
}

// ── Arbiter Registry ──────────────────────────────────────────────────────────

/** Register as an arbiter by staking XLM. Same as contractRegisterArbiterWithStake. */
export async function contractRegisterArbiter(arbiterAddress, stakeAmount) {
  return invokeContract(arbiterAddress, 'register_arbiter', [
    addressVal(arbiterAddress),
    i128Val(stakeAmount),
  ]);
}

/** Get the full list of registered arbiters. */
export async function contractGetArbiters() {
  return readOnly('get_arbiters', []);
}

/** Get the staked XLM amount for a specific arbiter. */
export async function contractGetArbiterStake(arbiterAddress) {
  return readOnly('get_arbiter_stake', [addressVal(arbiterAddress)]);
}

/**
 * getEscrowsForUser — fetches all escrows where the address is buyer OR seller.
 * Scans the last 50 escrows from the contract and filters by address.
 * Used to populate both parties' dashboards with their relevant escrows.
 */
export async function getEscrowsForUser(userAddress) {
  if (!CONTRACT_ID) return [];
  try {
    const total = await readOnly('escrow_count', []);
    if (!total || total === 0) return [];

    const count = Number(total);
    const startId = Math.max(1, count - 49); // fetch last 50 for performance

    const result = await readOnly('get_escrows_range', [
      u64Val(startId),
      u64Val(count),
    ]);

    if (!result || !Array.isArray(result)) return [];

    // Only return escrows where this user is directly involved
    return result.filter(e =>
      e.buyer === userAddress || e.seller === userAddress
    );
  } catch { return []; }
}

/**
 * contractSetFee — admin-only function to update the platform fee.
 * @param newFeeBps - fee in basis points (e.g. 100 = 1%, max 500 = 5%)
 */
export async function contractSetFee(adminAddress, newFeeBps) {
  return invokeContract(adminAddress, 'set_fee', [
    xdr.ScVal.scvU32(parseInt(newFeeBps)),
  ]);
}

// ── Resolution Intent (Off-chain Advisory Coordination) ───────────────────────
// These functions talk to the backend Redis layer, NOT the smart contract.
// They coordinate who is "about to" resolve a dispute to reduce race conditions.
// This is purely advisory — the contract itself has no access control on resolve_dispute.

/**
 * signalResolutionIntent — tells the backend "I'm about to resolve this dispute."
 * Other resolvers will see this and back off during the priority window.
 *
 * Priority is determined by:
 *  - Whether the caller is an assigned arbiter (+big bonus)
 *  - Their staked XLM amount (logarithmic weight)
 *  - Their historical reliability score
 *  - Time remaining in the priority window
 *
 * Returns { blocked: false, ... } if intent was accepted.
 * Returns { blocked: true, ... } if a higher-priority resolver already claimed it.
 */
export async function signalResolutionIntent(callerAddress, escrowId, isArbiter = false, rewardStroops = 0, callerBalance = 0, stakeAmount = 0, escrowArbitrators = []) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/intent/${escrowId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        caller: callerAddress, 
        is_arbiter: isArbiter,
        reward_stroops: rewardStroops,
        caller_balance: callerBalance,
        stake_amount: stakeAmount,
        escrow_arbitrators: escrowArbitrators,
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.status === 409) return { blocked: true, ...data };           // higher priority resolver exists
    if (res.status === 403) return { blocked: true, insufficient_balance: true, ...data }; // balance too low
    if (res.status === 429) return { blocked: true, rate_limited: true, ...data };         // too many attempts
    if (!res.ok) return null;
    return { blocked: false, ...data };
  } catch { return null; }
}

/**
 * getResolutionIntent — reads the current intent for a dispute.
 * Returns who is currently "claiming" the resolution slot and how long they have.
 * Returns null on network failure — treat as "no intent known".
 */
export async function getResolutionIntent(escrowId) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/intent/${escrowId}`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

/**
 * trackResolutionExecution — reports whether a resolution attempt succeeded or failed.
 * Used to build the resolver's reliability score over time.
 * Non-critical — failures are silently ignored.
 */
export async function trackResolutionExecution(callerAddress, escrowId, success = true) {
  try {
    await fetch(`${BACKEND_URL}/api/intent/${escrowId}/executed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caller: callerAddress, success }),
    });
  } catch { /* silent — non-critical */ }
}

/**
 * getUserStats — fetch a resolver's full behavioral stats from the backend.
 * Returns: { total_intents, successful_resolutions, failed_resolutions, abandoned_intents }
 */
export async function getUserStats(address) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/user-stats/${address}`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

/**
 * getReliabilityScore — legacy alias for getUserStats.
 * Returns the same stats object.
 */
export async function getReliabilityScore(address) {
  return getUserStats(address);
}

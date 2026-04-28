/**
 * Orchid Escrow Contract Client
 * ──────────────────────────────
 * Wired to the new production contract:
 * CDFOU467L7VRG7HFXWYBNUYMEFTW73I2E6L2HN33RHOCHEGDFKQL2JPH
 *
 * New contract functions:
 *   create_escrow(buyer, seller, arbitrator?, token, amount, deadline)
 *   fund(escrow_id, caller)
 *   approve(escrow_id, caller)          ← dual-approval (replaces confirm_delivery)
 *   cancel(escrow_id, caller)           ← buyer cancels before deadline
 *   dispute(escrow_id, caller)          ← either party raises dispute
 *   arbitrate(escrow_id, caller, decision) ← arbitrator resolves
 *   auto_release(escrow_id)             ← anyone after deadline
 *   get_escrow(escrow_id)
 *   escrow_count()
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
const BASE_FEE     = '300000';
// Native XLM token on testnet
const NATIVE_TOKEN  = import.meta.env.VITE_NATIVE_TOKEN  || 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
// Dummy funded account for read-only simulations
const DUMMY_ACCOUNT = import.meta.env.VITE_ADMIN_ADDRESS  || 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';

let rpcServer;
try {
  rpcServer = new SorobanRpc.Server(RPC_URL);
} catch (e) {
  rpcServer = null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function addressVal(addr) { return new Address(addr).toScVal(); }
function u64Val(n)        { return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(n))); }
function i128Val(xlm) {
  const stroops = BigInt(Math.round(parseFloat(xlm) * 1e7));
  return nativeToScVal(stroops, { type: 'i128' });
}
function optionNone() {
  // Soroban Option::None = scvVoid
  return xdr.ScVal.scvVoid();
}
function optionSome(val) {
  // Soroban Option::Some(Address) = the address ScVal directly
  // (Soroban SDK unwraps Option automatically when the type is Option<T>)
  return val;
}

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

  const simResult = await rpcServer.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult))
    throw new Error(`Simulation failed: ${simResult.error}`);

  const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
  const xdrStr = assembled.toXDR();

  const result = await StellarWalletsKit.signTransaction(xdrStr, {
    networkPassphrase: NETWORK_PASS,
    address: callerAddress,
  });
  const signedXdr = typeof result === 'string' ? result : result?.signedTxXdr ?? result?.xdr;
  if (!signedXdr) throw new Error('Signing cancelled');

  const sendResult = await rpcServer.sendTransaction(
    TransactionBuilder.fromXDR(signedXdr, NETWORK_PASS)
  );
  if (sendResult.status === 'ERROR')
    throw new Error(`Submit failed: ${sendResult.errorResult?.toXDR('base64')}`);

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
  } catch { /* silent */ }
  return null;
}

// ── Contract Functions ────────────────────────────────────────────────────────

/**
 * Create escrow + fund in one flow.
 * useArbitration = false → Mode A (trust-minimized, no dispute path)
 * useArbitration = true  → Mode B (contract auto-assigns panel from registered pool)
 * Users CANNOT specify arbitrators — the contract selects them.
 * Returns { escrow_id, hash }
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
  const deliveryWindowSecs = 3 * 86400;

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
 * mark_delivered — seller signals delivery is complete.
 * Must be called before buyer can confirm.
 */
export async function contractMarkDelivered(sellerAddress, escrowId) {
  return invokeContract(sellerAddress, 'mark_delivered', [
    u64Val(escrowId),
    addressVal(sellerAddress),
  ]);
}

/**
 * confirm_delivery — buyer confirms delivery. Requires Delivered state.
 * Funds sent to seller immediately.
 */
export async function contractConfirmDelivery(buyerAddress, escrowId) {
  return invokeContract(buyerAddress, 'confirm_delivery', [
    u64Val(escrowId),
    addressVal(buyerAddress),
  ]);
}
export async function contractCancel(buyerAddress, escrowId) {
  return invokeContract(buyerAddress, 'cancel', [
    u64Val(escrowId),
    addressVal(buyerAddress),
  ]);
}

/**
 * dispute — either party raises a dispute (requires arbitrator).
 */
export async function contractDispute(callerAddress, escrowId) {
  return invokeContract(callerAddress, 'dispute', [
    u64Val(escrowId),
    addressVal(callerAddress),
  ]);
}

/**
 * vote — arbitrator casts their vote on a disputed escrow.
 * decision: 'Release' or 'Refund'
 */
export async function contractVote(arbitratorAddress, escrowId, decision) {
  // Soroban enum variant = scvEnum with the variant name as a symbol
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
 * refund_after_deadline — buyer reclaims funds if seller never delivered.
 * Permissionless — anyone can call, funds always go to buyer.
 */
export async function contractRefundAfterDeadline(callerAddress, escrowId) {
  return invokeContract(callerAddress, 'refund_after_deadline', [
    u64Val(escrowId),
  ]);
}

/**
 * register_arbiter — stake XLM to join the arbiter registry.
 * stakeXlm: amount in XLM (e.g. "0.1")
 */
export async function contractRegisterArbiterWithStake(arbiterAddress, stakeXlm) {
  return invokeContract(arbiterAddress, 'register_arbiter', [
    addressVal(arbiterAddress),
    i128Val(stakeXlm),
  ]);
}

/**
 * finalize — finalize dispute after majority is reached.
 */
export async function contractFinalize(callerAddress, escrowId) {
  return invokeContract(callerAddress, 'finalize', [
    u64Val(escrowId),
  ]);
}

/**
 * force_finalize — force finalize if arbitration deadline passed.
 */
export async function contractForceFinalize(callerAddress, escrowId) {
  return invokeContract(callerAddress, 'force_finalize', [
    u64Val(escrowId),
  ]);
}

/**
 * arbitrate — arbitrator resolves dispute.
 * decision: 'Release' (pay seller) or 'Refund' (pay buyer)
 * DEPRECATED: Use vote() + finalize() instead
 */
export async function contractArbitrate(arbitratorAddress, escrowId, decision) {
  // ArbitratorDecision is a Soroban enum — encode as scvVec with symbol tag
  const decisionVal = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol(decision === 'Release' ? 'Release' : 'Refund'),
  ]);

  return invokeContract(arbitratorAddress, 'arbitrate', [
    u64Val(escrowId),
    addressVal(arbitratorAddress),
    decisionVal,
  ]);
}

/**
 * auto_release — anyone calls after deadline.
 */
export async function contractAutoRelease(callerAddress, escrowId) {
  return invokeContract(callerAddress, 'auto_release', [
    u64Val(escrowId),
  ]);
}

/**
 * auto_release_after_delivery — if buyer disappears after delivery.
 */
export async function contractAutoReleaseAfterDelivery(callerAddress, escrowId) {
  return invokeContract(callerAddress, 'auto_release_after_delivery', [
    u64Val(escrowId),
  ]);
}

// ── Legacy aliases ────────────────────────────────────────────────────────────

/** Alias: request_refund = cancel (buyer before delivery) */
export async function contractRequestRefund(buyerAddress, escrowId) {
  return contractCancel(buyerAddress, escrowId);
}

/** Alias: approve_refund = cancel */
export async function contractApproveRefund(buyerAddress, escrowId) {
  return contractCancel(buyerAddress, escrowId);
}

// ── Read-only Views ───────────────────────────────────────────────────────────

export async function contractGetEscrow(escrowId) {
  return readOnly('get_escrow', [u64Val(escrowId)]);
}

export async function contractEscrowCount() {
  const result = await readOnly('escrow_count', []);
  return result ?? 0;
}

export async function contractGetFeeBps() {
  return readOnly('get_fee_bps', []);
}

export async function contractGetVotes(escrowId) {
  return readOnly('get_votes', [u64Val(escrowId)]);
}

export async function contractIsModeB(escrowId) {
  return readOnly('is_mode_b', [u64Val(escrowId)]);
}

/** Returns panel size (3/5/7) for a given XLM amount. */
export async function contractGetPanelSize(amountXlm) {
  const stroops = BigInt(Math.round(parseFloat(amountXlm) * 1e7));
  return readOnly('get_panel_size', [nativeToScVal(stroops, { type: 'i128' })]);
}

/** Returns count of eligible (staked) arbiters in the pool. */
export async function contractGetEligibleArbiterCount() {
  return readOnly('get_eligible_arbiter_count', []);
}

/** Slash inactive arbiters after dispute_deadline. Permissionless. */
export async function contractSlashInactive(callerAddress, escrowId) {
  return invokeContract(callerAddress, 'slash_inactive', [u64Val(escrowId)]);
}

/** Slash minority voters after finalize. Permissionless. */
export async function contractSlashMinority(callerAddress, escrowId) {
  return invokeContract(callerAddress, 'slash_minority', [u64Val(escrowId)]);
}

/** Distribute dispute fee pool to majority voters. Permissionless. */
export async function contractDistributeRewards(callerAddress, escrowId) {
  return invokeContract(callerAddress, 'distribute_rewards', [u64Val(escrowId)]);
}

/** Request unstake — starts 7-day cooldown. */
export async function contractRequestUnstake(arbiterAddress) {
  return invokeContract(arbiterAddress, 'request_unstake', [addressVal(arbiterAddress)]);
}

/** Claim unstaked tokens after cooldown. */
export async function contractClaimUnstake(arbiterAddress) {
  return invokeContract(arbiterAddress, 'claim_unstake', [addressVal(arbiterAddress)]);
}

/** Get arbiter participation stats: [total_assigned, missed_votes] */
export async function contractGetArbiterStats(arbiterAddress) {
  return readOnly('get_arbiter_stats', [addressVal(arbiterAddress)]);
}

/** Get unstake cooldown end timestamp (0 = no request). */
export async function contractGetUnstakeAt(arbiterAddress) {
  return readOnly('get_unstake_at', [addressVal(arbiterAddress)]);
}

/** Get dispute fee pool for an escrow. */
export async function contractGetDisputeFeePool(escrowId) {
  return readOnly('get_dispute_fee_pool', [u64Val(escrowId)]);
}

/** Get dispute spike status: [count, window_start]. */
export async function contractGetDisputeSpikeStatus() {
  return readOnly('get_dispute_spike_status', []);
}

/** Get arbiter reputation score. */
export async function contractGetArbiterReputation(arbiterAddress) {
  return readOnly('get_arbiter_reputation', [addressVal(arbiterAddress)]);
}

/** Get count of minority votes for an arbiter. */
export async function contractGetArbiterMinorityVotes(arbiterAddress) {
  return readOnly('get_arbiter_minority_votes', [addressVal(arbiterAddress)]);
}

/** Get escrow_id of last dispute this arbiter was assigned to. */
export async function contractGetArbiterLastSelected(arbiterAddress) {
  return readOnly('get_arbiter_last_selected', [addressVal(arbiterAddress)]);
}

export async function contractGetRole(userAddress, escrowId) {
  return readOnly('get_role', [addressVal(userAddress), u64Val(escrowId)]);
}

export async function contractGetUserEscrows(userAddress) {
  return readOnly('get_user_escrows', [addressVal(userAddress)]);
}

export async function contractGetActiveEscrows() {
  return readOnly('get_active_escrows', []);
}

// ── Arbiter Registry ──────────────────────────────────────────────────────────

export async function contractRegisterArbiter(arbiterAddress, stakeAmount) {
  return invokeContract(arbiterAddress, 'register_arbiter', [
    addressVal(arbiterAddress),
    i128Val(stakeAmount),
  ]);
}

export async function contractGetArbiters() {
  return readOnly('get_arbiters', []);
}

export async function contractGetArbiterStake(arbiterAddress) {
  return readOnly('get_arbiter_stake', [addressVal(arbiterAddress)]);
}

/**
 * getEscrowsForUser — fetches all escrows where address is buyer OR seller.
 * Scans the last N escrows from the contract and filters by address.
 * Used to show escrows on BOTH parties' dashboards.
 */
export async function getEscrowsForUser(userAddress) {
  if (!CONTRACT_ID) return [];
  try {
    const total = await readOnly('escrow_count', []);
    if (!total || total === 0) return [];

    const count = Number(total);
    // Fetch last 50 escrows max for performance
    const startId = Math.max(1, count - 49);

    const result = await readOnly('get_escrows_range', [
      u64Val(startId),
      u64Val(count),
    ]);

    if (!result || !Array.isArray(result)) return [];

    // Filter to only escrows where user is buyer or seller
    return result.filter(e =>
      e.buyer === userAddress || e.seller === userAddress
    );
  } catch { return []; }
}

/**
 * set_fee — admin only. Updates platform fee (max 500 = 5%).
 */
export async function contractSetFee(adminAddress, newFeeBps) {
  return invokeContract(adminAddress, 'set_fee', [
    xdr.ScVal.scvU32(parseInt(newFeeBps)),
  ]);
}

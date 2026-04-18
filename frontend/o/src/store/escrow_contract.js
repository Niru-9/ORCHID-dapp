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

const rpcServer = new SorobanRpc.Server(RPC_URL);

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
 * arbitratorAddress = null for no arbitrator.
 * Returns { escrow_id, hash }
 */
export async function contractCreateEscrow(
  buyerAddress,
  sellerAddress,
  amountXlm,
  expiryDays,
  arbitratorAddress = null
) {
  const now      = Math.floor(Date.now() / 1000);
  const deadline = now + parseInt(expiryDays) * 86400;

  // Arbitrator is Option<Address> — None = void, Some = address
  const arbitratorArg = arbitratorAddress
    ? optionSome(addressVal(arbitratorAddress))
    : optionNone();

  // Step 1: create_escrow
  const createResult = await invokeContract(buyerAddress, 'create_escrow', [
    addressVal(buyerAddress),
    addressVal(sellerAddress),
    arbitratorArg,
    addressVal(NATIVE_TOKEN),
    i128Val(amountXlm),
    u64Val(deadline),
  ]);

  const escrowId = scValToNative(createResult.result);

  // Step 2: fund (transfers XLM from buyer → contract)
  const fundResult = await invokeContract(buyerAddress, 'fund', [
    u64Val(escrowId),
    addressVal(buyerAddress),
  ]);

  return { escrow_id: escrowId, hash: fundResult.hash };
}

/**
 * approve — either buyer or seller approves release.
 * When both approve, funds go to seller automatically.
 */
export async function contractApprove(callerAddress, escrowId) {
  return invokeContract(callerAddress, 'approve', [
    u64Val(escrowId),
    addressVal(callerAddress),
  ]);
}

/**
 * cancel — buyer cancels before deadline, gets refund.
 */
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
 * arbitrate — arbitrator resolves dispute.
 * decision: 'Release' (pay seller) or 'Refund' (pay buyer)
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

// ── Legacy aliases (keep wallet.js working without changes) ──────────────────

/** Alias: buyer confirms delivery = buyer approves */
export async function contractConfirmDelivery(buyerAddress, escrowId) {
  return contractApprove(buyerAddress, escrowId);
}

/** Alias: request_refund = cancel (buyer) */
export async function contractRequestRefund(buyerAddress, escrowId) {
  return contractCancel(buyerAddress, escrowId);
}

/** Alias: approve_refund = cancel (buyer) — same outcome */
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

/**
 * set_fee — admin only. Updates platform fee (max 500 = 5%).
 */
export async function contractSetFee(adminAddress, newFeeBps) {
  return invokeContract(adminAddress, 'set_fee', [
    xdr.ScVal.scvU32(parseInt(newFeeBps)),
  ]);
}

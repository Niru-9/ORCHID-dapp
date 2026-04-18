/**
 * Orchid Pool Contract Client
 * ────────────────────────────
 * Calls the deployed Soroban lending pool contract directly.
 * All funds held by the contract — no custody wallet needed.
 *
 * Contract: CBKY6KEKIKVQXYKWK2C3GTNT7XMT5ZJLHCYNEZCVO3RHSY7MKL3F4IPZ
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

const RPC_URL     = import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = import.meta.env.VITE_POOL_CONTRACT_ID;
const NET_PASS    = Networks.TESTNET;
const BASE_FEE    = '300000';
// Dummy funded account for read-only simulations
const DUMMY = import.meta.env.VITE_ADMIN_ADDRESS || 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';

const rpc = new SorobanRpc.Server(RPC_URL);

// ── Helpers ───────────────────────────────────────────────────────────────────

function addrVal(addr)  { return new Address(addr).toScVal(); }
function u64Val(n)      { return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(n))); }
function i128Val(xlm)   {
  const stroops = BigInt(Math.round(parseFloat(xlm) * 1e7));
  return nativeToScVal(stroops, { type: 'i128' });
}

async function invoke(caller, method, args) {
  if (!CONTRACT_ID) throw new Error('VITE_POOL_CONTRACT_ID not set');

  const account  = await rpc.getAccount(caller);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NET_PASS })
    .addOperation(Operation.invokeContractFunction({
      contract: CONTRACT_ID,
      function: method,
      args,
    }))
    .setTimeout(60)
    .build();

  const sim = await rpc.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim))
    throw new Error(`Simulation failed: ${sim.error}`);

  const assembled = SorobanRpc.assembleTransaction(tx, sim).build();
  const xdrStr = assembled.toXDR();

  const result = await StellarWalletsKit.signTransaction(xdrStr, {
    networkPassphrase: NET_PASS, address: caller,
  });
  const signedXdr = typeof result === 'string' ? result : result?.signedTxXdr ?? result?.xdr;
  if (!signedXdr) throw new Error('Signing cancelled');

  const send = await rpc.sendTransaction(
    TransactionBuilder.fromXDR(signedXdr, NET_PASS)
  );
  if (send.status === 'ERROR')
    throw new Error(`Submit failed: ${send.errorResult?.toXDR('base64')}`);

  const hash = send.hash;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const s = await rpc.getTransaction(hash);
    if (s.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS)
      return { hash, result: s.returnValue };
    if (s.status === SorobanRpc.Api.GetTransactionStatus.FAILED)
      throw new Error(`Contract call failed: ${hash}`);
  }
  throw new Error('Confirmation timeout');
}

async function readOnly(method, args) {
  if (!CONTRACT_ID) return null;
  try {
    const account = await rpc.getAccount(DUMMY);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NET_PASS })
      .addOperation(Operation.invokeContractFunction({
        contract: CONTRACT_ID,
        function: method,
        args,
      }))
      .setTimeout(60)
      .build();
    const sim = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationSuccess(sim) && sim.result?.retval)
      return scValToNative(sim.result.retval);
  } catch { /* silent */ }
  return null;
}

// ── Pool Functions ────────────────────────────────────────────────────────────

/** Deposit XLM into the pool. Returns { hash } */
export async function poolDeposit(lenderAddress, amountXlm) {
  return invoke(lenderAddress, 'deposit', [
    addrVal(lenderAddress),
    i128Val(amountXlm),
  ]);
}

/** Withdraw XLM from the pool (principal + accrued interest). */
export async function poolWithdraw(lenderAddress, amountXlm) {
  return invoke(lenderAddress, 'withdraw', [
    addrVal(lenderAddress),
    i128Val(amountXlm),
  ]);
}

/** Deposit collateral before borrowing. */
export async function poolDepositCollateral(borrowerAddress, amountXlm) {
  return invoke(borrowerAddress, 'deposit_collateral', [
    addrVal(borrowerAddress),
    i128Val(amountXlm),
  ]);
}

/** Withdraw collateral (only if health factor stays safe). */
export async function poolWithdrawCollateral(borrowerAddress, amountXlm) {
  return invoke(borrowerAddress, 'withdraw_collateral', [
    addrVal(borrowerAddress),
    i128Val(amountXlm),
  ]);
}

/** Borrow from the pool. Returns { hash, loan_id } */
export async function poolBorrow(borrowerAddress, amountXlm, termDays) {
  const result = await invoke(borrowerAddress, 'borrow', [
    addrVal(borrowerAddress),
    i128Val(amountXlm),
    u64Val(termDays),
  ]);
  const loanId = result.result ? scValToNative(result.result) : null;
  return { hash: result.hash, loan_id: loanId };
}

/** Repay a loan (full or partial). */
export async function poolRepay(borrowerAddress, loanId, amountXlm) {
  return invoke(borrowerAddress, 'repay', [
    addrVal(borrowerAddress),
    u64Val(loanId),
    i128Val(amountXlm),
  ]);
}

/** Liquidate an unhealthy position. */
export async function poolLiquidate(liquidatorAddress, borrowerAddress, loanId) {
  return invoke(liquidatorAddress, 'liquidate', [
    addrVal(liquidatorAddress),
    addrVal(borrowerAddress),
    u64Val(loanId),
  ]);
}

/** Create a fixed deposit. Returns { hash, fd_id } */
export async function poolCreateFD(ownerAddress, amountXlm, termDays) {
  const result = await invoke(ownerAddress, 'create_fd', [
    addrVal(ownerAddress),
    i128Val(amountXlm),
    u64Val(termDays),
  ]);
  const fdId = result.result ? scValToNative(result.result) : null;
  return { hash: result.hash, fd_id: fdId };
}

/** Claim a matured fixed deposit. */
export async function poolClaimFD(ownerAddress, fdId) {
  return invoke(ownerAddress, 'claim_fd', [
    addrVal(ownerAddress),
    u64Val(fdId),
  ]);
}

/** Early withdrawal with 10% penalty. */
export async function poolEarlyWithdrawFD(ownerAddress, fdId) {
  return invoke(ownerAddress, 'early_withdraw_fd', [
    addrVal(ownerAddress),
    u64Val(fdId),
  ]);
}

// ── Read-only Views ───────────────────────────────────────────────────────────

export async function getPoolStats()              { return readOnly('get_pool_state', []); }
export async function getPoolState()              { return readOnly('get_pool_state', []); }
export async function getBorrowRate()             { return readOnly('get_borrow_rate', []); }
export async function getSupplyApy()              { return readOnly('get_supply_apy', []); }
export async function getHealthFactor(addr)       { return readOnly('get_health_factor', [addrVal(addr)]); }
export async function getCreditScore(addr)        { return readOnly('get_credit_score', [addrVal(addr)]); }
export async function getMaxBorrow(addr)          { return readOnly('get_max_borrow', [addrVal(addr)]); }
export async function getCollateral(addr)         { return readOnly('get_collateral', [addrVal(addr)]); }
export async function getLoan(addr, loanId)       { return readOnly('get_loan', [addrVal(addr), u64Val(loanId)]); }
export async function getFD(addr, fdId)           { return readOnly('get_fd', [addrVal(addr), u64Val(fdId)]); }
export async function getSupplyPosition(addr)     { return readOnly('get_supply_position', [addrVal(addr)]); }
export async function getHealthInfo(addr)         { return readOnly('get_health_info', [addrVal(addr)]); }
export async function getProtocolFees()           { return readOnly('get_protocol_fees', []); }

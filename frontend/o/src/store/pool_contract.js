/**
 * Orchid Pool Contract Client
 * ────────────────────────────
 * Frontend bridge to the deployed Soroban lending pool contract.
 * All funds are held directly by the contract — no custody wallet needed.
 *
 * Contract ID: set via VITE_POOL_CONTRACT_ID in .env
 *
 * What this contract does:
 *  - Lenders deposit XLM → earn interest (supply APY)
 *  - Borrowers deposit collateral → borrow XLM → repay with interest
 *  - Fixed Deposits → lock XLM for a term → earn higher APY
 *  - Liquidation → unhealthy positions can be liquidated by anyone
 *
 * All write functions require the user to sign with their wallet.
 * All read functions are free (simulation only, no signing).
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
const CONTRACT_ID = import.meta.env.VITE_POOL_CONTRACT_ID || null;
const NET_PASS    = Networks.TESTNET;
const BASE_FEE    = '300000'; // 0.03 XLM — covers Soroban compute fees

// Funded account used for read-only simulations (no wallet needed)
const DUMMY = import.meta.env.VITE_ADMIN_ADDRESS || 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';

// Safe RPC init — won't crash if env vars are missing
let rpc;
try {
  rpc = new SorobanRpc.Server(RPC_URL);
} catch (e) {
  rpc = null;
}

// ── Value Encoding Helpers ────────────────────────────────────────────────────

/** Converts a Stellar address string (G...) into a Soroban ScVal. */
function addrVal(addr)  { return new Address(addr).toScVal(); }

/** Converts a JS number into a Soroban u64 ScVal (used for IDs, term days). */
function u64Val(n)      { return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(n))); }

/**
 * Converts an XLM amount (e.g. "10.5") into a Soroban i128 ScVal in stroops.
 * 1 XLM = 10,000,000 stroops.
 */
function i128Val(xlm)   {
  const stroops = BigInt(Math.round(parseFloat(xlm) * 1e7));
  return nativeToScVal(stroops, { type: 'i128' });
}

// ── Core Transaction Engine ───────────────────────────────────────────────────

/**
 * invoke — builds, simulates, signs, and submits a state-changing contract call.
 *
 * Flow:
 *  1. Load caller's account from RPC
 *  2. Build the transaction
 *  3. Simulate to get resource footprint (required by Soroban)
 *  4. Assemble with simulation data
 *  5. Ask wallet to sign
 *  6. Submit and poll until confirmed (max 60s)
 *
 * Returns { hash, result } on success. Throws on any failure.
 */
async function invoke(caller, method, args) {
  if (!CONTRACT_ID) throw new Error('Pool contract not configured — set VITE_POOL_CONTRACT_ID in Vercel env vars');
  if (!rpc) throw new Error('RPC not initialized');

  const account  = await rpc.getAccount(caller);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NET_PASS })
    .addOperation(Operation.invokeContractFunction({
      contract: CONTRACT_ID,
      function: method,
      args,
    }))
    .setTimeout(60)
    .build();

  // Simulate first — required to get Soroban resource fees
  const sim = await rpc.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim))
    throw new Error(`Simulation failed: ${sim.error}`);

  // Assemble adds auth entries and resource limits from simulation
  const assembled = SorobanRpc.assembleTransaction(tx, sim).build();
  const xdrStr = assembled.toXDR();

  // Ask the wallet (Freighter / WalletConnect) to sign
  const result = await StellarWalletsKit.signTransaction(xdrStr, {
    networkPassphrase: NET_PASS, address: caller,
  });
  const signedXdr = typeof result === 'string' ? result : result?.signedTxXdr ?? result?.xdr;
  if (!signedXdr) throw new Error('Signing cancelled');

  // Submit the signed transaction
  const send = await rpc.sendTransaction(
    TransactionBuilder.fromXDR(signedXdr, NET_PASS)
  );
  if (send.status === 'ERROR')
    throw new Error(`Submit failed: ${send.errorResult?.toXDR('base64')}`);

  // Poll every 2 seconds until confirmed (max 60s)
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

/**
 * readOnly — simulates a read-only contract call without signing.
 * Free to call — no gas cost, no wallet needed.
 * Returns the decoded native JS value, or null on failure.
 */
async function readOnly(method, args) {
  if (!CONTRACT_ID || !rpc) return null;
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
  } catch { /* silent — read failures are non-critical */ }
  return null;
}

// ── Pool Write Functions ──────────────────────────────────────────────────────

/**
 * poolDeposit — lender deposits XLM into the pool to earn supply APY.
 * Funds are held by the contract and lent out to borrowers.
 * @returns { hash }
 */
export async function poolDeposit(lenderAddress, amountXlm) {
  return invoke(lenderAddress, 'deposit', [
    addrVal(lenderAddress),
    i128Val(amountXlm),
  ]);
}

/**
 * poolWithdraw — lender withdraws their supplied XLM plus accrued interest.
 * Only possible if the pool has enough liquidity (not all lent out).
 */
export async function poolWithdraw(lenderAddress, amountXlm) {
  return invoke(lenderAddress, 'withdraw', [
    addrVal(lenderAddress),
    i128Val(amountXlm),
  ]);
}

/**
 * poolDepositCollateral — borrower deposits XLM as collateral before borrowing.
 * Required collateral ratio: 160% of the borrow amount (over-collateralized).
 */
export async function poolDepositCollateral(borrowerAddress, amountXlm) {
  return invoke(borrowerAddress, 'deposit_collateral', [
    addrVal(borrowerAddress),
    i128Val(amountXlm),
  ]);
}

/**
 * poolWithdrawCollateral — borrower withdraws collateral.
 * Contract enforces that the health factor stays safe after withdrawal.
 */
export async function poolWithdrawCollateral(borrowerAddress, amountXlm) {
  return invoke(borrowerAddress, 'withdraw_collateral', [
    addrVal(borrowerAddress),
    i128Val(amountXlm),
  ]);
}

/**
 * poolBorrow — borrow XLM from the pool against deposited collateral.
 * @param termDays - loan term in days (30, 90, or 180)
 * @returns { hash, loan_id } — loan_id is the on-chain ID for repayment
 */
export async function poolBorrow(borrowerAddress, amountXlm, termDays) {
  const result = await invoke(borrowerAddress, 'borrow', [
    addrVal(borrowerAddress),
    i128Val(amountXlm),
    u64Val(termDays),
  ]);
  // Decode the returned loan ID from the contract result
  const loanId = result.result ? scValToNative(result.result) : null;
  return { hash: result.hash, loan_id: loanId };
}

/**
 * poolRepay — repay a loan (full or partial).
 * @param loanId    - on-chain loan ID returned by poolBorrow
 * @param amountXlm - amount to repay (can be partial)
 */
export async function poolRepay(borrowerAddress, loanId, amountXlm) {
  return invoke(borrowerAddress, 'repay', [
    addrVal(borrowerAddress),
    u64Val(loanId),
    i128Val(amountXlm),
  ]);
}

/**
 * poolLiquidate — liquidate an unhealthy borrower position.
 * Called by a liquidator when a borrower's health factor drops below 1.
 * Liquidator receives a bonus for executing the liquidation.
 */
export async function poolLiquidate(liquidatorAddress, borrowerAddress, loanId) {
  return invoke(liquidatorAddress, 'liquidate', [
    addrVal(liquidatorAddress),
    addrVal(borrowerAddress),
    u64Val(loanId),
  ]);
}

/**
 * poolCreateFD — create a fixed deposit (lock XLM for a fixed term).
 * Earns higher APY than regular supply. Cannot be withdrawn early without penalty.
 * @param termDays - lock period: 30, 90, 180, 365, 1095, or 1825 days
 * @returns { hash, fd_id } — fd_id is the on-chain ID for claiming
 */
export async function poolCreateFD(ownerAddress, amountXlm, termDays) {
  const result = await invoke(ownerAddress, 'create_fd', [
    addrVal(ownerAddress),
    i128Val(amountXlm),
    u64Val(termDays),
  ]);
  // Decode the returned FD ID from the contract result
  const fdId = result.result ? scValToNative(result.result) : null;
  return { hash: result.hash, fd_id: fdId };
}

/**
 * poolClaimFD — claim a matured fixed deposit (principal + interest).
 * Can only be called after the lock period has ended.
 */
export async function poolClaimFD(ownerAddress, fdId) {
  return invoke(ownerAddress, 'claim_fd', [
    addrVal(ownerAddress),
    u64Val(fdId),
  ]);
}

/**
 * poolEarlyWithdrawFD — withdraw a fixed deposit before maturity.
 * Incurs a 10% penalty on the principal. Use only if necessary.
 */
export async function poolEarlyWithdrawFD(ownerAddress, fdId) {
  return invoke(ownerAddress, 'early_withdraw_fd', [
    addrVal(ownerAddress),
    u64Val(fdId),
  ]);
}

// ── Read-only View Functions ──────────────────────────────────────────────────
// All free to call — simulate only, no signing, no gas cost.

/** Get pool-wide stats: total_supplied, total_borrowed, utilization rate. */
export async function getPoolStats()              { return readOnly('get_pool_stats', []); }

/** Alias for getPoolStats — same data, different name used in some views. */
export async function getPoolState()              { return readOnly('get_pool_stats', []); }

/** Get the current borrow interest rate (annualized %). */
export async function getBorrowRate()             { return readOnly('get_borrow_rate', []); }

/** Get the current supply APY for lenders (annualized %). */
export async function getSupplyApy()              { return readOnly('get_supply_apy', []); }

/**
 * getHealthFactor — get a borrower's health factor.
 * > 1.0 = safe, < 1.0 = liquidatable.
 */
export async function getHealthFactor(addr)       { return readOnly('get_health_factor', [addrVal(addr)]); }

/** Get a user's on-chain credit score (300–800 range). */
export async function getCreditScore(addr)        { return readOnly('get_credit_score', [addrVal(addr)]); }

/** Get the maximum amount a user can borrow given their current collateral. */
export async function getMaxBorrow(addr)          { return readOnly('get_max_borrow', [addrVal(addr)]); }

/** Get a user's current collateral balance in stroops. */
export async function getCollateral(addr)         { return readOnly('get_collateral', [addrVal(addr)]); }

/** Get details of a specific loan by address and loan ID. */
export async function getLoan(addr, loanId)       { return readOnly('get_loan', [addrVal(addr), u64Val(loanId)]); }

/** Get a lender's current supply position (amount + accrued interest). */
export async function getSupplyPosition(addr)     { return readOnly('get_supply_position', [addrVal(addr)]); }

/** Get accumulated protocol fees (admin use). */
export async function getProtocolFees()           { return readOnly('get_protocol_fees', []); }

// ── UI Helper Views ───────────────────────────────────────────────────────────

/** Get all active loans for a user address. */
export async function getUserLoans(addr)          { return readOnly('get_user_loans', [addrVal(addr)]); }

/** Get aggregated dashboard data for the pool overview page. */
export async function getDashboardData()          { return readOnly('get_dashboard_data', []); }

/** Get the insurance fund status (covers bad debt in extreme scenarios). */
export async function getInsuranceStatus()        { return readOnly('get_insurance_status', []); }

/** Get the maximum borrowable amount for a user (alias for getMaxBorrow). */
export async function maxBorrowable(addr)         { return readOnly('max_borrowable', [addrVal(addr)]); }

/** Get the expected total interest for a specific loan. */
export async function expectedInterest(loanId, addr) {
  return readOnly('expected_interest', [u64Val(loanId), addrVal(addr)]);
}

// ── Compatibility Aliases ─────────────────────────────────────────────────────

/** Alias for getHealthFactor — used in some older view components. */
export async function getHealthInfo(addr)         { return readOnly('get_health_factor', [addrVal(addr)]); }

/** Get details of a specific fixed deposit by address and FD ID. */
export async function getFD(addr, fdId)           { return readOnly('get_fd', [addrVal(addr), u64Val(fdId)]); }

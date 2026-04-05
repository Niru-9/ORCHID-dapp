/**
 * Orchid Escrow Contract Client
 * ──────────────────────────────
 * Calls the deployed Soroban escrow contract directly.
 * Funds go INTO the contract — no custody wallet needed.
 *
 * Contract: CBSRC76C3WHLSZP6K3QNAVEZERX4G3YT6ECRFU5YED2ILZ35NGQ7GSXN
 */

import {
  rpc as SorobanRpc,
  TransactionBuilder,
  Networks,
  nativeToScVal,
  Address,
  xdr,
  scValToNative,
} from '@stellar/stellar-sdk';
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit/sdk';

const RPC_URL      = 'https://soroban-testnet.stellar.org';
const CONTRACT_ID  = import.meta.env.VITE_ESCROW_CONTRACT_ID;
const NETWORK_PASS = Networks.TESTNET;
const BASE_FEE     = '100000'; // 0.01 XLM — Soroban needs higher fee than Horizon

const rpcServer = new SorobanRpc.Server(RPC_URL);

// ── Helpers ───────────────────────────────────────────────────────────────────

function addressVal(addr) {
  return new Address(addr).toScVal();
}

function u64Val(n) {
  return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(n)));
}

function i128Val(n) {
  // i128 as ScVal — amount in stroops (XLM * 1e7)
  const stroops = BigInt(Math.round(parseFloat(n) * 1e7));
  return nativeToScVal(stroops, { type: 'i128' });
}

/**
 * Build, simulate, sign and submit a Soroban contract call.
 */
async function invokeContract(callerAddress, method, args) {
  if (!CONTRACT_ID) throw new Error('VITE_ESCROW_CONTRACT_ID not set');

  // 1. Load account
  const account = await rpcServer.getAccount(callerAddress);

  // 2. Build transaction
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASS,
  })
    .addOperation(
      xdr.Operation.invokeContractFunction({
        contractAddress: new Address(CONTRACT_ID).toScAddress(),
        functionName:    method,
        args,
      })
    )
    .setTimeout(60)
    .build();

  // 3. Simulate to get footprint + auth
  const simResult = await rpcServer.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  // 4. Assemble (applies footprint + resource fees)
  const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();

  // 5. Sign via wallet kit
  const xdrStr = assembled.toXDR();
  const result = await StellarWalletsKit.signTransaction(xdrStr, {
    networkPassphrase: NETWORK_PASS,
    address: callerAddress,
  });
  const signedXdr = typeof result === 'string' ? result : result?.signedTxXdr ?? result?.xdr;
  if (!signedXdr) throw new Error('Signing cancelled');

  // 6. Submit
  const sendResult = await rpcServer.sendTransaction(
    TransactionBuilder.fromXDR(signedXdr, NETWORK_PASS)
  );

  if (sendResult.status === 'ERROR') {
    throw new Error(`Submit failed: ${sendResult.errorResult?.toXDR('base64')}`);
  }

  // 7. Poll for confirmation
  const hash = sendResult.hash;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status = await rpcServer.getTransaction(hash);
    if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return { hash, result: status.returnValue };
    }
    if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Contract call failed: ${hash}`);
    }
  }
  throw new Error('Transaction confirmation timeout');
}

// ── Contract Functions ────────────────────────────────────────────────────────

/**
 * create_escrow + fund in one flow.
 * Returns { escrow_id, hash }
 */
export async function contractCreateEscrow(
  buyerAddress,
  sellerAddress,
  amountXlm,
  expiryDays,
  refundWindowDays = 3
) {
  const now = Math.floor(Date.now() / 1000);
  const deadline      = now + parseInt(expiryDays)      * 86400;
  const refundWindow  = parseInt(refundWindowDays)       * 86400;

  // Native XLM token address on testnet
  const NATIVE_TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

  // Step 1: create_escrow
  const createResult = await invokeContract(buyerAddress, 'create_escrow', [
    addressVal(buyerAddress),
    addressVal(sellerAddress),
    addressVal(NATIVE_TOKEN),
    i128Val(amountXlm),
    u64Val(deadline),
    u64Val(refundWindow),
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
 * confirm_delivery — buyer confirms, contract pays seller.
 */
export async function contractConfirmDelivery(buyerAddress, escrowId) {
  return invokeContract(buyerAddress, 'confirm_delivery', [
    u64Val(escrowId),
    addressVal(buyerAddress),
  ]);
}

/**
 * request_refund — seller requests refund.
 */
export async function contractRequestRefund(sellerAddress, escrowId) {
  return invokeContract(sellerAddress, 'request_refund', [
    u64Val(escrowId),
    addressVal(sellerAddress),
  ]);
}

/**
 * approve_refund — buyer approves, contract returns funds to buyer.
 */
export async function contractApproveRefund(buyerAddress, escrowId) {
  return invokeContract(buyerAddress, 'approve_refund', [
    u64Val(escrowId),
    addressVal(buyerAddress),
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
 * get_escrow — read state (no auth needed, uses RPC directly).
 */
export async function contractGetEscrow(escrowId) {
  if (!CONTRACT_ID) return null;
  try {
    const result = await rpcServer.simulateTransaction(
      new TransactionBuilder(
        await rpcServer.getAccount('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN'),
        { fee: BASE_FEE, networkPassphrase: NETWORK_PASS }
      )
        .addOperation(xdr.Operation.invokeContractFunction({
          contractAddress: new Address(CONTRACT_ID).toScAddress(),
          functionName: 'get_escrow',
          args: [u64Val(escrowId)],
        }))
        .setTimeout(60)
        .build()
    );
    if (SorobanRpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      return scValToNative(result.result.retval);
    }
  } catch { /* silent */ }
  return null;
}

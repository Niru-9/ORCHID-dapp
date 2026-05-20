/**
 * Soroban Contract Integration (Backend)
 * ────────────────────────────────────────
 * Read-only contract queries used by the backend to verify on-chain escrow state.
 * The backend never signs or submits transactions — it only reads.
 *
 * Used for:
 *  - Confirming an escrow has been resolved before updating Redis
 *  - Checking Mode A (terminal status) vs Mode B (EscrowResolved flag) resolution
 */

const StellarSdk = require('@stellar/stellar-sdk');
const { Contract, TransactionBuilder, Networks, BASE_FEE, nativeToScVal, scValToNative } = StellarSdk;

// Soroban RPC endpoint — the gateway for smart contract reads on Stellar
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const ESCROW_CONTRACT_ID = process.env.ESCROW_CONTRACT_ID;
const NETWORK_PASSPHRASE = Networks.TESTNET;

// Connect to the Soroban RPC node — all contract reads go through here
const server = new StellarSdk.rpc.Server(SOROBAN_RPC_URL);

/**
 * getEscrowState — reads the full state of an escrow from the contract.
 * This is a simulation (read-only) — no gas cost, no signing required.
 *
 * @param {number} escrowId - on-chain escrow ID to query
 * @returns {{ success, resolved?, status?, escrow?, error? }}
 */
async function getEscrowState(escrowId) {
  try {
    // Reference the deployed escrow contract by its on-chain address
    const contract = new Contract(ESCROW_CONTRACT_ID);

    // Convert the JS number to a Soroban-compatible u64 ScVal
    const escrowIdScVal = nativeToScVal(escrowId, { type: 'u64' });

    // We need a source account to build the transaction structure,
    // but since this is a simulation, the account doesn't need to be real or funded.
    const { Keypair } = StellarSdk;
    const dummyKeypair = Keypair.random();
    const dummyAccount = await server.getAccount(dummyKeypair.publicKey()).catch(() => null);
    
    // If the random keypair doesn't exist on-chain, use a minimal placeholder object
    let sourceAccount;
    if (!dummyAccount) {
      sourceAccount = {
        accountId: () => dummyKeypair.publicKey(),
        sequenceNumber: () => '0',
        incrementSequenceNumber: () => {},
      };
    } else {
      sourceAccount = dummyAccount;
    }
    
    // Build a transaction that calls `get_escrow` on the contract
    let transaction = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call('get_escrow', escrowIdScVal))
      .setTimeout(30)
      .build();

    // Simulate — reads contract state without spending gas or submitting to the network
    const simulated = await server.simulateTransaction(transaction);
    
    // If simulation errored, the escrow likely doesn't exist or the call failed
    if (StellarSdk.rpc.Api.isSimulationError(simulated)) {
      console.error(`Escrow ${escrowId} simulation failed:`, simulated.error);
      return { success: false, error: `Simulation failed: ${simulated.error}` };
    }

    const result = simulated.result?.retval;
    if (result) {
      // Convert the raw Soroban ScVal back into a plain JS object
      const escrow = scValToNative(result);
      
      // Status enum from the contract: 1 = Resolved
      const isResolved = escrow.status === 1 || escrow.status === 'Resolved';
      
      return { success: true, resolved: isResolved, status: escrow.status, escrow };
    }

    return { success: false, error: 'No result returned' };
  } catch (error) {
    console.error(`Error getting escrow ${escrowId} state:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * checkIsResolvedFlag — checks the lightweight `is_resolved` boolean on the contract.
 * This flag is set when resolve_dispute is called (Mode B dispute path).
 * Faster than fetching the full escrow state.
 *
 * @param {number} escrowId
 * @returns {Promise<boolean>} — true if the EscrowResolved flag is set
 */
async function checkIsResolvedFlag(escrowId) {
  try {
    const contract = new Contract(ESCROW_CONTRACT_ID);
    const escrowIdScVal = nativeToScVal(escrowId, { type: 'u64' });

    // Dummy keypair — only needed to satisfy the transaction builder, not for signing
    const { Keypair } = StellarSdk;
    const dummyKeypair = Keypair.random();
    
    const sourceAccount = {
      accountId: () => dummyKeypair.publicKey(),
      sequenceNumber: () => '0',
      incrementSequenceNumber: () => {},
    };
    
    // Call `is_resolved` — a lightweight boolean check on the contract
    let transaction = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call('is_resolved', escrowIdScVal))
      .setTimeout(30)
      .build();

    const simulated = await server.simulateTransaction(transaction);
    
    // If simulation fails, treat as not resolved (safe default — don't falsely mark as done)
    if (StellarSdk.rpc.Api.isSimulationError(simulated)) return false;

    const result = simulated.result?.retval;
    if (result) return scValToNative(result) === true;

    return false;
  } catch (error) {
    console.error(`Error checking is_resolved flag for escrow ${escrowId}:`, error.message);
    return false;
  }
}

/**
 * verifyEscrowResolved — the main function called by the backend to confirm
 * an escrow is fully resolved before updating Redis state.
 *
 * An escrow is considered resolved if EITHER:
 *  1. Status is terminal (Mode A): "Released", "Refunded", or "Cancelled"
 *  2. EscrowResolved flag is set (Mode B): resolve_dispute was called on-chain
 *
 * This dual-check ensures both escrow modes are correctly detected.
 *
 * @param {number} escrowId
 * @returns {Promise<boolean>}
 */
async function verifyEscrowResolved(escrowId) {
  // Step 1: Fetch the full escrow state from the contract
  const state = await getEscrowState(escrowId);
  
  if (!state.success || !state.escrow) {
    console.log(JSON.stringify({
      event: 'VERIFICATION_FAILED',
      escrow_id: escrowId,
      reason: 'Failed to fetch escrow state',
      error: state.error,
    }));
    return false;
  }
  
  // Step 2: Extract status — Soroban returns enums as arrays: ["Released"], ["Disputed"], etc.
  const status = Array.isArray(state.escrow.status) ? state.escrow.status[0] : state.escrow.status;
  
  // Step 3: Check if status is terminal (Mode A resolution path)
  const terminalStatuses = ['Released', 'Refunded', 'Cancelled'];
  const isTerminalState = terminalStatuses.includes(status);
  
  // Step 4: Check EscrowResolved flag (Mode B dispute resolution path)
  const isResolvedFlag = await checkIsResolvedFlag(escrowId);
  
  // Step 5: Resolved if EITHER condition is true
  const finalResult = isTerminalState || isResolvedFlag;
  
  // Step 6: Structured log — useful for tracing resolution flow in production
  console.log(JSON.stringify({
    event: 'ESCROW_VERIFICATION',
    escrow_id: escrowId,
    status,
    is_terminal_state: isTerminalState,
    is_resolved_flag: isResolvedFlag,
    final_result: finalResult,
    mode: state.escrow.use_arbitration ? 'B' : 'A',
  }));
  
  return finalResult;
}

module.exports = { getEscrowState, verifyEscrowResolved, checkIsResolvedFlag };

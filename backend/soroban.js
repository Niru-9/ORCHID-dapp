/**
 * Soroban Contract Integration
 * Handles on-chain contract verification for escrow resolution
 */

const StellarSdk = require('@stellar/stellar-sdk');
const { Contract, TransactionBuilder, Networks, BASE_FEE, nativeToScVal, scValToNative } = StellarSdk;

const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const ESCROW_CONTRACT_ID = process.env.ESCROW_CONTRACT_ID;
const NETWORK_PASSPHRASE = Networks.TESTNET;

// Initialize Soroban RPC server
const server = new StellarSdk.rpc.Server(SOROBAN_RPC_URL);

/**
 * Get escrow state from contract (read-only)
 * Verifies if an escrow has been resolved on-chain
 * 
 * @param {number} escrowId - Escrow ID to query
 * @returns {Promise<{success: boolean, resolved?: boolean, status?: string, error?: string}>}
 */
async function getEscrowState(escrowId) {
  try {
    const contract = new Contract(ESCROW_CONTRACT_ID);
    const escrowIdScVal = nativeToScVal(escrowId, { type: 'u64' });

    // Create a dummy keypair for simulation (read-only, no signing needed)
    const { Keypair } = StellarSdk;
    const dummyKeypair = Keypair.random();
    const dummyAccount = await server.getAccount(dummyKeypair.publicKey()).catch(() => null);
    
    // If dummy account doesn't exist, use a known funded account
    let sourceAccount;
    if (!dummyAccount) {
      // Use a placeholder - simulation doesn't require real account for read-only
      sourceAccount = {
        accountId: () => dummyKeypair.publicKey(),
        sequenceNumber: () => '0',
        incrementSequenceNumber: () => {},
      };
    } else {
      sourceAccount = dummyAccount;
    }
    
    let transaction = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call('get_escrow', escrowIdScVal))
      .setTimeout(30)
      .build();

    const simulated = await server.simulateTransaction(transaction);
    
    if (StellarSdk.rpc.Api.isSimulationError(simulated)) {
      console.error(`Escrow ${escrowId} simulation failed:`, simulated.error);
      return {
        success: false,
        error: `Simulation failed: ${simulated.error}`,
      };
    }

    // Parse result
    const result = simulated.result?.retval;
    if (result) {
      // Convert ScVal to native JS
      const escrow = scValToNative(result);
      
      // Check if escrow is resolved
      // Status enum: Disputed = 0, Resolved = 1, Refunded = 2, Expired = 3
      const isResolved = escrow.status === 1 || escrow.status === 'Resolved';
      
      return {
        success: true,
        resolved: isResolved,
        status: escrow.status,
        escrow,
      };
    }

    return {
      success: false,
      error: 'No result returned',
    };
  } catch (error) {
    console.error(`Error getting escrow ${escrowId} state:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Check if escrow has EscrowResolved flag set (from resolve_dispute)
 * 
 * @param {number} escrowId - Escrow ID to check
 * @returns {Promise<boolean>} - true if EscrowResolved flag is set
 */
async function checkIsResolvedFlag(escrowId) {
  try {
    const contract = new Contract(ESCROW_CONTRACT_ID);
    const escrowIdScVal = nativeToScVal(escrowId, { type: 'u64' });

    const { Keypair } = StellarSdk;
    const dummyKeypair = Keypair.random();
    
    const sourceAccount = {
      accountId: () => dummyKeypair.publicKey(),
      sequenceNumber: () => '0',
      incrementSequenceNumber: () => {},
    };
    
    let transaction = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call('is_resolved', escrowIdScVal))
      .setTimeout(30)
      .build();

    const simulated = await server.simulateTransaction(transaction);
    
    if (StellarSdk.rpc.Api.isSimulationError(simulated)) {
      return false;
    }

    const result = simulated.result?.retval;
    if (result) {
      return scValToNative(result) === true;
    }

    return false;
  } catch (error) {
    console.error(`Error checking is_resolved flag for escrow ${escrowId}:`, error.message);
    return false;
  }
}

/**
 * Verify if an escrow has been resolved on-chain
 * This is called by the backend to confirm resolution before updating Redis
 * 
 * VERIFICATION LOGIC:
 * An escrow is considered resolved if EITHER:
 * 1. Status is in terminal state (Mode A resolution):
 *    - "Released" (buyer confirmed delivery)
 *    - "Refunded" (buyer got refund after deadline)
 *    - "Cancelled" (buyer cancelled before deadline)
 * 2. EscrowResolved flag is set (Mode B dispute resolution via resolve_dispute)
 * 
 * This ensures both Mode A and Mode B escrows are correctly detected.
 * 
 * @param {number} escrowId - Escrow ID to verify
 * @returns {Promise<boolean>} - true if resolved on-chain, false otherwise
 */
async function verifyEscrowResolved(escrowId) {
  // STEP 1: Fetch full escrow state
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
  
  // STEP 2: Extract status (handle Soroban enum array format)
  // Status is returned as an array: ["Released"], ["Refunded"], ["Disputed"], etc.
  const status = Array.isArray(state.escrow.status) ? state.escrow.status[0] : state.escrow.status;
  
  // STEP 3: Check if status is terminal (Mode A resolution)
  const terminalStatuses = ['Released', 'Refunded', 'Cancelled'];
  const isTerminalState = terminalStatuses.includes(status);
  
  // STEP 4: Check EscrowResolved flag (Mode B dispute resolution)
  const isResolvedFlag = await checkIsResolvedFlag(escrowId);
  
  // STEP 5: Final determination - resolved if EITHER condition is true
  const finalResult = isTerminalState || isResolvedFlag;
  
  // STEP 6: Debug logging with all signals
  console.log(JSON.stringify({
    event: 'ESCROW_VERIFICATION',
    escrow_id: escrowId,
    status: status,
    is_terminal_state: isTerminalState,
    is_resolved_flag: isResolvedFlag,
    final_result: finalResult,
    mode: state.escrow.use_arbitration ? 'B' : 'A',
  }));
  
  return finalResult;
}

module.exports = {
  getEscrowState,
  verifyEscrowResolved,
  checkIsResolvedFlag,
};


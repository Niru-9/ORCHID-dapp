/**
 * Orchid Disbursement Engine
 * ──────────────────────────
 * Signs and submits outgoing XLM payments FROM custody accounts TO users.
 * Handles: borrow payouts, FD maturity payouts, escrow releases/refunds.
 *
 * Secret keys are stored ONLY in backend env vars — never exposed to the frontend.
 *
 * NOTE: With Soroban contracts deployed, most payouts are handled on-chain by
 * the contracts themselves. This engine is a legacy fallback for any remaining
 * custody-wallet disbursements.
 */

const {
  Horizon,
  TransactionBuilder,
  Networks,
  Asset,
  Operation,
  Keypair,
  Memo,
} = require('@stellar/stellar-sdk');

const db = require('./db');

// Stellar testnet Horizon server — the gateway for submitting transactions
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
const server = new Horizon.Server(HORIZON_URL);

// ── Custody Keypair Loader ────────────────────────────────────────────────────

/**
 * getKeypair — safely loads a Stellar keypair from an environment variable.
 * Throws a clear error if the env var is missing, rather than crashing silently.
 *
 * @param {string} secretEnvKey - name of the env var holding the secret key
 * @returns {Keypair}
 */
function getKeypair(secretEnvKey) {
  const secret = process.env[secretEnvKey];
  if (!secret) throw new Error(`Missing env var: ${secretEnvKey}`);
  return Keypair.fromSecret(secret);
}

/**
 * sendFromCustody — builds, signs, and submits a Stellar XLM payment.
 * Used to send funds from a custody account to a user's wallet.
 *
 * @param {Keypair} senderKeypair - the custody account's keypair (signs the tx)
 * @param {string}  recipient     - destination Stellar public key (G...)
 * @param {number}  amount        - XLM amount to send
 * @param {string}  memo          - optional memo text (max 28 bytes on Stellar)
 * @returns {string} - the on-chain transaction hash
 */
async function sendFromCustody(senderKeypair, recipient, amount, memo = '') {
  // Load the sender's current sequence number from the network (required for tx building)
  const account = await server.loadAccount(senderKeypair.publicKey());

  // Fetch the current network base fee to avoid underpaying and getting rejected
  const fee = await server.fetchBaseFee();

  const builder = new TransactionBuilder(account, {
    fee: fee.toString(),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.payment({
      destination: recipient,
      asset: Asset.native(),                       // XLM (the native Stellar asset)
      amount: parseFloat(amount).toFixed(7),       // Stellar requires exactly 7 decimal places
    }))
    .setTimeout(60); // Transaction expires in 60 seconds if not included in a ledger

  // Attach a human-readable memo (helps users identify the payment in their wallet)
  if (memo) builder.addMemo(Memo.text(memo.slice(0, 28)));

  const tx = builder.build();

  // Sign with the custody account's private key
  tx.sign(senderKeypair);

  // Submit to the Stellar network and return the transaction hash
  const res = await server.submitTransaction(tx);
  return res.hash;
}

/**
 * processPendingDisbursements — processes all payout jobs that are due now.
 * Called by the scheduler in index.js every 60 seconds.
 *
 * Flow:
 *  1. Fetch all pending disbursements from Redis whose releaseAt has passed
 *  2. For each one, pick the right custody keypair (pool or escrow)
 *  3. Sign and submit the payment to Stellar
 *  4. Mark the job as completed in Redis
 *  5. Record the tx in analytics
 */
async function processPendingDisbursements() {
  // Guard: if no custody keys are configured, skip silently
  // (Soroban contracts handle payouts directly in the new architecture)
  if (!process.env.POOL_SECRET_KEY && !process.env.ESCROW_SECRET_KEY) {
    return;
  }

  let pending;
  try {
    // Fetch only disbursements whose releaseAt time has passed
    pending = await db.getPendingDisbursements();
  } catch (e) {
    console.error('[Disburse] Failed to fetch pending disbursements:', e.message);
    return;
  }

  if (pending.length === 0) return;

  console.log(`[Disburse] Processing ${pending.length} pending disbursement(s)`);

  // Process each job one at a time (sequential to avoid sequence number conflicts)
  for (const disb of pending) {
    try {
      // Pick the right custody keypair based on which account the funds come from
      const keypairEnvKey = disb.fromAccount === 'escrow'
        ? 'ESCROW_SECRET_KEY'
        : 'POOL_SECRET_KEY';

      let keypair;
      try {
        keypair = getKeypair(keypairEnvKey);
      } catch (e) {
        // If the key isn't configured, skip this job rather than crashing the whole loop
        console.warn(`[Disburse] Skipping disbursement ${disb.id}: ${e.message}`);
        continue;
      }

      // Map disbursement type to a human-readable Stellar memo (max 28 bytes)
      const memoText = {
        borrow:          'Orchid Loan',
        fd_maturity:     'Orchid FD Payout',
        supply_interest: 'Orchid Supply Interest',
        escrow_release:  'Orchid Escrow Release',
        escrow_refund:   'Orchid Escrow Refund',
      }[disb.type] || 'Orchid Payout';

      // Sign and submit the payment to the Stellar network
      const txHash = await sendFromCustody(
        keypair,
        disb.recipient,
        disb.amount,
        memoText
      );

      // Mark the job as completed in Redis and attach the on-chain hash
      await db.completeDisbursement(disb.id, txHash);

      // Record the outgoing tx in analytics so it shows up in the dashboard
      await db.recordTx({
        tx_hash: txHash,
        amount: disb.amount,
        source_account: keypair.publicKey(),
        type: memoText,
        success: true,
      });

      console.log(`[Disburse] ✅ ${disb.type} → ${disb.recipient} ${disb.amount} XLM | hash: ${txHash}`);
    } catch (err) {
      // Log the failure but keep processing the rest of the queue
      console.error(`[Disburse] ❌ Failed ${disb.id}:`, err.message);
    }
  }
}

module.exports = { processPendingDisbursements, sendFromCustody };

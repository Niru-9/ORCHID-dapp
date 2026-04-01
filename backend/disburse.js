/**
 * Orchid Disbursement Engine
 * ──────────────────────────
 * Signs and submits outgoing transactions FROM custody accounts TO users.
 * Handles: borrow payouts, FD maturity payouts, escrow releases/refunds.
 *
 * Secret keys are stored ONLY in backend env vars — never exposed to frontend.
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

const HORIZON_URL = 'https://horizon-testnet.stellar.org';

const NETWORK_PASSPHRASE = Networks.TESTNET;
const server = new Horizon.Server(HORIZON_URL);

// ── Load custody keypairs from env ────────────────────────────────────────────
function getKeypair(secretEnvKey) {
  const secret = process.env[secretEnvKey];
  if (!secret) throw new Error(`Missing env var: ${secretEnvKey}`);
  return Keypair.fromSecret(secret);
}

/**
 * Send XLM from a custody account to a recipient.
 * @param {Keypair} senderKeypair
 * @param {string}  recipient  - destination public key
 * @param {number}  amount     - XLM amount
 * @param {string}  memo       - optional memo text
 */
async function sendFromCustody(senderKeypair, recipient, amount, memo = '') {
  const account = await server.loadAccount(senderKeypair.publicKey());
  const fee = await server.fetchBaseFee();

  const builder = new TransactionBuilder(account, {
    fee: fee.toString(),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.payment({
      destination: recipient,
      asset: Asset.native(),
      amount: parseFloat(amount).toFixed(7),
    }))
    .setTimeout(60);

  if (memo) builder.addMemo(Memo.text(memo.slice(0, 28)));

  const tx = builder.build();
  tx.sign(senderKeypair);

  const res = await server.submitTransaction(tx);
  return res.hash;
}

/**
 * Process all pending disbursements that are due now.
 * Called by the scheduler every 60 seconds.
 */
async function processPendingDisbursements() {
  const pending = await db.getPendingDisbursements();
  if (pending.length === 0) return;

  console.log(`[Disburse] Processing ${pending.length} pending disbursement(s)`);

  for (const disb of pending) {
    try {
      // Pick the right custody keypair
      const keypairEnvKey = disb.fromAccount === 'escrow'
        ? 'ESCROW_SECRET_KEY'
        : 'POOL_SECRET_KEY';

      const keypair = getKeypair(keypairEnvKey);

      const memoText = {
        borrow:          'Orchid Loan',
        fd_maturity:     'Orchid FD Payout',
        supply_interest: 'Orchid Supply Interest',
        escrow_release:  'Orchid Escrow Release',
        escrow_refund:   'Orchid Escrow Refund',
      }[disb.type] || 'Orchid Payout';

      const txHash = await sendFromCustody(
        keypair,
        disb.recipient,
        disb.amount,
        memoText
      );

      await db.completeDisbursement(disb.id, txHash);

      // Record the outgoing tx in analytics
      await db.recordTx({
        tx_hash: txHash,
        amount: disb.amount,
        source_account: keypair.publicKey(),
        type: memoText,
        success: true,
      });

      console.log(`[Disburse] ✅ ${disb.type} → ${disb.recipient} ${disb.amount} XLM | hash: ${txHash}`);
    } catch (err) {
      console.error(`[Disburse] ❌ Failed ${disb.id}:`, err.message);
    }
  }
}

module.exports = { processPendingDisbursements, sendFromCustody };

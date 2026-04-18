import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useWalletStore } from '../store/wallet';
import { useToast } from '../components/Toast';

export default function Escrow() {
  const { createEscrow, releaseEscrow, refundEscrow, disputeEscrow, autoReleaseEscrow, checkEscrowExpiry, transactions, address } = useWalletStore();
  const toast = useToast();
  
  const [seller, setSeller] = useState('');
  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState('XLM');
  const [description, setDescription] = useState('');
  const [expiryDays, setExpiryDays] = useState('7');
  const [isCreating, setIsCreating] = useState(false);
  const [processingId, setProcessingId] = useState(null);

  useEffect(() => {
    checkEscrowExpiry();
    const interval = setInterval(checkEscrowExpiry, 60000);
    return () => clearInterval(interval);
  }, [checkEscrowExpiry]);

  const handleCreateEscrow = async (e) => {
    e.preventDefault();
    if (!seller || !amount) return;
    setIsCreating(true);
    try {
      const hash = await createEscrow(seller, amount, asset, description, expiryDays);
      toast.txSuccess('Escrow created! Funds locked in contract.', hash);
      setSeller(''); setAmount(''); setDescription('');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  // Mark Delivered = confirm delivery AND release funds to seller immediately
  const handleMarkDelivered = async (id) => {
    const tx = transactions.find(t => t.id === id);
    if (!tx) return;

    const confirmed = window.confirm(
      `✅ CONFIRM DELIVERY & RELEASE PAYMENT\n\n` +
      `Marking as delivered will immediately release:\n\n` +
      `  Amount : ${tx.amount}\n` +
      `  To     : ${tx.merchant}\n\n` +
      `This is IRREVERSIBLE. Funds will be sent to the seller now.\n\nConfirm?`
    );
    if (!confirmed) return;

    setProcessingId(id);
    try {
      const hash = await releaseEscrow(id);
      toast.txSuccess('Delivery confirmed! Payment sent to seller.', hash);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setProcessingId(null);
    }
  };

  // Force Refund = send funds back to the buyer (current user who created the escrow)
  const handleRefund = async (id) => {
    const tx = transactions.find(t => t.id === id);
    if (!tx) return;

    const confirmed = window.confirm(
      `⚠️ REFUND AUTHORIZATION\n\n` +
      `Funds will be returned to your wallet:\n\n` +
      `  Amount : ${tx.amount}\n\n` +
      `This action is IRREVERSIBLE.\n\nProceed?`
    );
    if (!confirmed) return;

    setProcessingId(id);
    try {
      const hash = await refundEscrow(id);
      toast.txSuccess('Funds refunded to your wallet!', hash);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const getTimeRemaining = (expiresAt) => {
    if (!expiresAt) return 'N/A';
    const diff = new Date(expiresAt).getTime() - new Date().getTime();
    if (diff <= 0) return 'Expired';
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h`;
  };

  const escrowTxs = transactions.filter(t => t.type === 'Create Escrow');

  const getStatusColor = (status) => {
    if (status === 'Funded') return { bg: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', border: 'rgba(56, 189, 248, 0.2)' };
    if (status === 'Delivered') return { bg: 'rgba(234, 179, 8, 0.1)', color: '#eab308', border: 'rgba(234, 179, 8, 0.2)' };
    if (status === 'Released') return { bg: 'var(--success-bg)', color: 'var(--success-text)', border: 'rgba(52, 211, 153, 0.2)' };
    if (status === 'Disputed') return { bg: 'var(--error-bg)', color: 'var(--error-text)', border: 'rgba(239, 68, 68, 0.2)' };
    if (status === 'Expired') return { bg: 'rgba(249, 115, 22, 0.1)', color: '#f97316', border: 'rgba(249, 115, 22, 0.2)' };
    if (status === 'Refunded' || status?.includes('Refunded')) return { bg: 'rgba(168, 85, 247, 0.1)', color: '#a855f7', border: 'rgba(168, 85, 247, 0.2)' };
    return { bg: 'var(--warning-bg)', color: 'var(--warning-text)', border: 'rgba(251, 191, 36, 0.2)' };
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="view-header">
        <div>
          <div className="section-label">Secure Payments</div>
          <h2 className="view-title">Lock Funds</h2>
          <p className="view-subtitle">
            Lock money in a smart contract and release it only when you're satisfied. No bank, no arbitrator — just code. Perfect for freelance work, purchases, or any payment where trust matters.
          </p>
        </div>
        <a href={`https://stellar.expert/explorer/testnet/contract/${import.meta.env.VITE_ESCROW_CONTRACT_ID}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-glow)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', border: '1px solid rgba(168,85,247,0.2)', padding: '0.5rem 1rem', borderRadius: '0.5rem', flexShrink: 0 }}>
          View Contract ↗
        </a>
      </div>

      {/* How it works strip */}
      <div className="info-strip" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: '2.5rem' }}>
        <div className="info-strip-item">
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.5rem' }}>STEP 01</div>
          <div className="info-strip-title">Lock Funds in Contract</div>
          <p className="info-strip-body">You deposit XLM into the Soroban escrow contract. The funds are held on-chain — not in any wallet, not by any person. Only the contract rules can release them.</p>
        </div>
        <div className="info-strip-item">
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.5rem' }}>STEP 02</div>
          <div className="info-strip-title">Confirm Delivery</div>
          <p className="info-strip-body">Once the seller delivers what was agreed, you mark it complete. The contract instantly releases the full payment to the seller's wallet — no delays, no disputes.</p>
        </div>
        <div className="info-strip-item">
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.5rem' }}>STEP 03</div>
          <div className="info-strip-title">Auto-Expiry Protection</div>
          <p className="info-strip-body">Set an expiry window of 24 hours to 30 days. If no action is taken before expiry, the contract automatically refunds your wallet — you never lose access to your funds.</p>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.25rem', marginBottom: '2.5rem' }}>
        <div className="feature-card">
          <div className="stat-block-label">Total Contracts Created</div>
          <div className="stat-block-value" style={{ marginTop: '0.5rem', marginBottom: '0.4rem' }}>{escrowTxs.length}</div>
          <div className="stat-block-desc">All escrow contracts you have initiated from this wallet</div>
        </div>
        <div className="feature-card">
          <div className="stat-block-label">Funded & Active</div>
          <div className="stat-block-value" style={{ color: '#38bdf8', marginTop: '0.5rem', marginBottom: '0.4rem' }}>{escrowTxs.filter(t => t.status === 'Funded').length}</div>
          <div className="stat-block-desc">Funds are locked in the contract, awaiting your delivery confirmation</div>
        </div>
        <div className="feature-card">
          <div className="stat-block-label">Awaiting Release</div>
          <div className="stat-block-value" style={{ color: '#eab308', marginTop: '0.5rem', marginBottom: '0.4rem' }}>{escrowTxs.filter(t => t.status === 'Delivered').length}</div>
          <div className="stat-block-desc">Delivery has been marked — payment is pending final release to seller</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">Create New Escrow</h3>
          <form onSubmit={handleCreateEscrow} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="form-group">
              <label className="form-label">Seller / Recipient Address</label>
              <input type="text" value={seller} onChange={(e) => setSeller(e.target.value)} placeholder="G..." className="form-input mono" required disabled={isCreating} />
            </div>
            <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label className="form-label">Lock Amount</label>
                <div className="input-wrapper" style={{ marginTop: '0.5rem' }}>
                  <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="form-input" required disabled={isCreating} />
                  <select className="input-suffix" style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-main)' }} value={asset} onChange={(e) => setAsset(e.target.value)}>
                    <option value="XLM">XLM</option>
                    <option value="USDC">USDC</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="form-label">Auto-Expiry</label>
                <select className="form-input" style={{ width: '100%', marginTop: '0.5rem' }} value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} disabled={isCreating}>
                  <option value="1">24 Hours</option>
                  <option value="2">48 Hours</option>
                  <option value="7">7 Days</option>
                  <option value="30">30 Days</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Description / Memo</label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g., Logo Design — Milestone 1" className="form-input" disabled={isCreating} />
            </div>
            <button type="submit" disabled={isCreating || !seller || !amount} className="submit-btn" style={{ marginTop: '0.5rem' }}>
              {isCreating ? 'Creating Escrow...' : 'Lock Funds in Contract'}
            </button>
          </form>
        </div>

        <div className="card">
          <h3 className="card-title">Active Escrow Contracts</h3>
          <div className="table-container" style={{ maxHeight: '500px', overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Amount</th>
                  <th>Seller</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {escrowTxs.length > 0 ? (
                  escrowTxs.map((tx, i) => {
                    const sc = getStatusColor(tx.status);
                    return (
                      <tr key={i}>
                        <td className="mono" style={{ fontSize: '0.75rem' }}>
                          {tx.hash ? (
                            <a href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`} target="_blank" rel="noreferrer" style={{color: 'inherit'}}>
                              {tx.id}
                            </a>
                          ) : tx.id}
                        </td>
                        <td className="stat-value">{tx.amount}</td>
                        <td className="mono" style={{ fontSize: '0.7rem' }}>{tx.merchant ? `${tx.merchant.slice(0,4)}...${tx.merchant.slice(-4)}` : 'N/A'}</td>
                        <td style={{ fontSize: '0.8rem', color: getTimeRemaining(tx.expiresAt) === 'Expired' ? '#ef4444' : 'var(--text-muted)' }}>
                          {getTimeRemaining(tx.expiresAt)}
                        </td>
                        <td>
                          <span style={{ padding: '0.3rem 0.6rem', borderRadius: '9999px', fontSize: '0.65rem', fontWeight: 600, background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                            {tx.status}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            {tx.status === 'Funded' && (
                              <>
                                {tx.escrow_id ? (
                                  <button
                                    className="action-btn"
                                    style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem', background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.3)', color: '#10b981' }}
                                    onClick={() => handleMarkDelivered(tx.id)}
                                    disabled={processingId === tx.id}
                                  >
                                    {processingId === tx.id ? 'Processing...' : 'Mark Delivered'}
                                  </button>
                                ) : (
                                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Legacy escrow</span>
                                )}
                                {/* Seller can request refund via contract */}
                                {tx.escrow_id && (
                                  <button className="action-btn" style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }}
                                    disabled={processingId === tx.id}
                                    onClick={async () => {
                                      if (!window.confirm('Request a refund? The buyer will need to approve it.')) return;
                                      setProcessingId(tx.id);
                                      try {
                                        await useWalletStore.getState().requestEscrowRefund(tx.id);
                                        toast.success('Refund requested. Awaiting buyer approval.');
                                      } catch (err) { toast.error(err.message); }
                                      finally { setProcessingId(null); }
                                    }}>
                                    Request Refund
                                  </button>
                                )}
                              </>
                            )}
                            {tx.status === 'Delivered' && (
                              <span style={{ fontSize: '0.7rem', color: '#10b981' }}>Payment sent ✓</span>
                            )}
                            {tx.status === 'Disputed' && (
                              <button
                                className="action-btn"
                                style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }}
                                onClick={() => handleRefund(tx.id)}
                                disabled={processingId === tx.id}
                              >
                                {processingId === tx.id ? 'Processing...' : 'Force Refund'}
                              </button>
                            )}
                            {tx.status === 'Expired' && (
                              <button
                                className="action-btn"
                                style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem', borderColor: 'rgba(249,115,22,0.3)', color: '#f97316' }}
                                onClick={() => {
                                  setProcessingId(tx.id);
                                  autoReleaseEscrow(tx.id)
                                    .then(hash => toast.txSuccess('Auto-released to seller!', hash))
                                    .catch(err => toast.error(err.message))
                                    .finally(() => setProcessingId(null));
                                }}
                                disabled={processingId === tx.id}
                              >
                                {processingId === tx.id ? 'Processing...' : 'Auto Release'}
                              </button>
                            )}
                            {(tx.status === 'Released' || tx.status === 'Refunded' || tx.status?.includes('Refunded')) && (
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Settled</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No escrow contracts created yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {escrowTxs.some(tx => tx.description) && (
            <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text-main)' }}>Latest Memo:</strong> {escrowTxs.find(tx => tx.description)?.description}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}



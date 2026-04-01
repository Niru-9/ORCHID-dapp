import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useWalletStore } from '../store/wallet';

export default function Escrow() {
  const { createEscrow, releaseEscrow, refundEscrow, markDelivered, disputeEscrow, checkEscrowExpiry, transactions, escrowHoldings } = useWalletStore();
  
  const [seller, setSeller] = useState('');
  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState('XLM');
  const [description, setDescription] = useState('');
  const [expiryDays, setExpiryDays] = useState('7');
  const [isCreating, setIsCreating] = useState(false);

  // Check for expired escrows on mount and periodically
  useEffect(() => {
    checkEscrowExpiry();
    const interval = setInterval(checkEscrowExpiry, 60000); // every minute
    return () => clearInterval(interval);
  }, [checkEscrowExpiry]);

  const handleCreateEscrow = async (e) => {
    e.preventDefault();
    if (!seller || !amount) return;
    setIsCreating(true);
    try {
      const hash = await createEscrow(seller, amount, asset, description, expiryDays);
      alert(`Escrow created successfully! Hash: ${hash}`);
      setSeller(''); setAmount(''); setDescription('');
    } catch (err) {
      alert(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleRelease = async (id) => {
    const tx = transactions.find(t => t.id === id);
    if (!tx) return;

    // AUTHORIZATION GATE: Explicit confirmation required from the initiator before any funds move
    const confirmed = window.confirm(
      `⚠️ RELEASE AUTHORIZATION\n\n` +
      `You are about to release funds from escrow:\n\n` +
      `  Amount : ${tx.amount}\n` +
      `  To     : ${tx.merchant}\n\n` +
      `This action is IRREVERSIBLE and will initiate an on-chain transfer.\n\n` +
      `Are you sure you want to release these funds?`
    );
    if (!confirmed) return;

    try {
      const hash = await releaseEscrow(id);
      alert(`Funds Released Successfully!\nHash: ${hash}`);
    } catch(err) {
      alert(err.message);
    }
  };

  const handleRefund = async (id) => {
    const tx = transactions.find(t => t.id === id);
    if (!tx) return;

    // AUTHORIZATION GATE: Explicit confirmation required before initiating refund
    const confirmed = window.confirm(
      `⚠️ REFUND AUTHORIZATION\n\n` +
      `You are about to refund the following escrow:\n\n` +
      `  Amount : ${tx.amount}\n` +
      `  From   : ${tx.merchant}\n\n` +
      `Funds will be returned to your wallet. This action is IRREVERSIBLE.\n\n` +
      `Proceed with refund?`
    );
    if (!confirmed) return;

    try {
      const hash = await refundEscrow(id);
      alert(`Funds Refunded!\nHash: ${hash}`);
    } catch(err) {
      alert(err.message);
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
        <h2 className="view-title">Smart Escrow Payments</h2>
        <p className="view-subtitle">Trustless milestone-based payments. Funds are locked until delivery is confirmed or the contract expires.</p>
      </div>

      {/* Stats Row — Custody Holdings intentionally hidden (internal-only data) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <div className="card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Total Contracts</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '0.5rem' }}>{escrowTxs.length}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Funded</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '0.5rem', color: '#38bdf8' }}>{escrowTxs.filter(t => t.status === 'Funded').length}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Awaiting Release</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '0.5rem', color: '#eab308' }}>{escrowTxs.filter(t => t.status === 'Delivered').length}</div>
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
                                <button className="action-btn" style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem' }} onClick={() => markDelivered(tx.id)}>Mark Delivered</button>
                                <button className="action-btn" style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }} onClick={() => disputeEscrow(tx.id)}>Dispute</button>
                              </>
                            )}
                            {tx.status === 'Delivered' && (
                              <>
                                <button className="action-btn" style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem', background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.3)', color: '#10b981' }} onClick={() => handleRelease(tx.id)}>Release</button>
                                <button className="action-btn" style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }} onClick={() => disputeEscrow(tx.id)}>Dispute</button>
                              </>
                            )}
                            {tx.status === 'Disputed' && (
                              <button className="action-btn" style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem' }} onClick={() => handleRefund(tx.id)}>Force Refund</button>
                            )}
                            {tx.status === 'Expired' && (
                              <button className="action-btn" style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem', borderColor: 'rgba(249,115,22,0.3)', color: '#f97316' }} onClick={() => handleRefund(tx.id)}>Force Refund</button>
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

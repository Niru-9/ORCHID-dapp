import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useWalletStore } from '../store/wallet';
import { useToast } from '../components/Toast';
import { 
  getEscrowsForUser, 
  contractMarkDelivered, 
  contractConfirmDelivery,
  contractVote,
  contractFinalize,
  contractForceFinalize,
  contractGetVotes,
  contractGetRole,
  contractDispute
} from '../store/escrow_contract';

export default function Escrow() {
  const { createEscrow, releaseEscrow, refundEscrow, disputeEscrow, autoReleaseEscrow, checkEscrowExpiry, transactions, address } = useWalletStore();
  const toast = useToast();
  
  const [seller, setSeller] = useState('');
  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState('XLM');
  const [description, setDescription] = useState('');
  const [expiryDays, setExpiryDays] = useState('7');
  const [arbitrators, setArbitrators] = useState(['', '', '']); // Min 3 arbitrators
  const [isCreating, setIsCreating] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  // On-chain escrows visible to this user (as buyer OR seller OR arbitrator)
  const [onChainEscrows, setOnChainEscrows] = useState([]);
  const [loadingOnChain, setLoadingOnChain] = useState(false);
  const [votingEscrow, setVotingEscrow] = useState(null);
  const [voteDecision, setVoteDecision] = useState('Release');

  useEffect(() => {
    checkEscrowExpiry();
    const interval = setInterval(checkEscrowExpiry, 60000);
    return () => clearInterval(interval);
  }, [checkEscrowExpiry]);

  // Fetch on-chain escrows for this user (both buyer and seller roles)
  useEffect(() => {
    if (!address) return;
    const fetchOnChain = async () => {
      setLoadingOnChain(true);
      try {
        const escrows = await getEscrowsForUser(address);
        setOnChainEscrows(escrows || []);
      } catch (_) {}
      setLoadingOnChain(false);
    };
    fetchOnChain();
    const t = setInterval(fetchOnChain, 30_000);
    return () => clearInterval(t);
  }, [address]);

  const handleCreateEscrow = async (e) => {
    e.preventDefault();
    if (!seller || !amount) return;
    
    // Filter out empty arbitrator addresses
    const validArbitrators = arbitrators.filter(a => a.trim().length > 0);
    
    // Validate arbitrator count (must be 3-7 and odd)
    if (validArbitrators.length < 3) {
      toast.error('Minimum 3 arbitrators required');
      return;
    }
    if (validArbitrators.length > 7) {
      toast.error('Maximum 7 arbitrators allowed');
      return;
    }
    if (validArbitrators.length % 2 === 0) {
      toast.error('Arbitrator count must be odd (3, 5, or 7)');
      return;
    }
    
    setIsCreating(true);
    try {
      const hash = await createEscrow(seller, amount, asset, description, expiryDays, validArbitrators);
      toast.txSuccess('Escrow created with arbitration panel!', hash);
      setSeller(''); setAmount(''); setDescription('');
      setArbitrators(['', '', '']); // Reset to 3 empty slots
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleVote = async (escrowId, decision) => {
    setProcessingId(escrowId);
    try {
      await contractVote(address, escrowId, decision);
      toast.success(`Vote cast: ${decision}`);
      // Refresh escrows
      const updated = await getEscrowsForUser(address);
      setOnChainEscrows(updated || []);
      setVotingEscrow(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleFinalize = async (escrowId) => {
    setProcessingId(escrowId);
    try {
      await contractFinalize(address, escrowId);
      toast.txSuccess('Dispute finalized!', '');
      const updated = await getEscrowsForUser(address);
      setOnChainEscrows(updated || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleForceFinalize = async (escrowId) => {
    if (!window.confirm('Force finalize? This will refund the buyer after timeout.')) return;
    setProcessingId(escrowId);
    try {
      await contractForceFinalize(address, escrowId);
      toast.txSuccess('Force finalized - buyer refunded', '');
      const updated = await getEscrowsForUser(address);
      setOnChainEscrows(updated || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleDispute = async (escrowId) => {
    if (!window.confirm('Raise a dispute? This will require arbitrator panel voting.')) return;
    setProcessingId(escrowId);
    try {
      await contractDispute(address, escrowId);
      toast.success('Dispute raised! Arbitrators will vote.');
      const updated = await getEscrowsForUser(address);
      setOnChainEscrows(updated || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setProcessingId(null);
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
            
            {/* Arbitrator Panel */}
            <div className="form-group">
              <label className="form-label">Arbitration Panel (3-7 addresses, odd number)</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {arbitrators.map((arb, idx) => (
                  <input 
                    key={idx}
                    type="text" 
                    value={arb} 
                    onChange={(e) => {
                      const newArbs = [...arbitrators];
                      newArbs[idx] = e.target.value;
                      setArbitrators(newArbs);
                    }} 
                    placeholder={`Arbitrator ${idx + 1} address (G...)`}
                    className="form-input mono" 
                    style={{ fontSize: '0.8rem' }}
                    disabled={isCreating} 
                  />
                ))}
                {arbitrators.length < 7 && (
                  <button 
                    type="button"
                    onClick={() => setArbitrators([...arbitrators, ''])}
                    className="action-btn"
                    style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', alignSelf: 'flex-start' }}
                    disabled={isCreating}
                  >
                    + Add Arbitrator
                  </button>
                )}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                Panel votes by majority. Minimum 3, maximum 7 arbitrators.
              </div>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 className="card-title" style={{ margin: 0 }}>Active Escrow Contracts</h3>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {loadingOnChain ? 'Syncing from chain...' : `${onChainEscrows.length} on-chain`}
            </div>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.6 }}>
            All escrows where you are the buyer or seller — visible to both parties.
          </p>
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

          {/* ── On-chain escrows (visible to both buyer and seller) ── */}
          {onChainEscrows.length > 0 && (
            <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: '0.75rem' }}>
                On-Chain Escrows (Your Role)
              </div>
              <div className="table-container" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Your Role</th>
                      <th>Amount</th>
                      <th>Counterparty</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {onChainEscrows.map((e, i) => {
                      const isBuyer = e.buyer === address;
                      const role = isBuyer ? 'Buyer' : 'Seller';
                      const counterparty = isBuyer ? e.seller : e.buyer;
                      const amountXlm = (Number(e.amount) / 1e7).toFixed(2);
                      const statusColor = {
                        Funded: '#38bdf8', Delivered: '#f59e0b',
                        Released: '#22C55E', AutoReleased: '#22C55E',
                        Refunded: '#a855f7', Cancelled: '#6b7280', Disputed: '#ef4444',
                      }[e.status] || 'var(--text-muted)';

                      return (
                        <tr key={i}>
                          <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem', color: 'var(--accent-glow)' }}>
                            <a href={`https://stellar.expert/explorer/testnet/contract/${import.meta.env.VITE_ESCROW_CONTRACT_ID}`} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
                              #{e.escrow_id}
                            </a>
                          </td>
                          <td>
                            <span style={{ padding: '0.2rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700, background: isBuyer ? 'rgba(59,130,246,0.1)' : 'rgba(34,197,94,0.1)', color: isBuyer ? '#60a5fa' : '#4ade80' }}>
                              {role}
                            </span>
                          </td>
                          <td style={{ fontWeight: 600 }}>{amountXlm} XLM</td>
                          <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {counterparty ? `${counterparty.slice(0,6)}...${counterparty.slice(-4)}` : '—'}
                          </td>
                          <td>
                            <span style={{ padding: '0.25rem 0.6rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600, background: `${statusColor}18`, color: statusColor }}>
                              {e.status}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                              {/* Seller: mark delivered */}
                              {!isBuyer && e.status === 'Funded' && (
                                <button
                                  className="action-btn"
                                  style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem', background: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.3)', color: '#f59e0b' }}
                                  disabled={processingId === e.escrow_id}
                                  onClick={async () => {
                                    setProcessingId(e.escrow_id);
                                    try {
                                      await contractMarkDelivered(address, e.escrow_id);
                                      toast.success('Delivery marked! Buyer can now confirm.');
                                      const updated = await getEscrowsForUser(address);
                                      setOnChainEscrows(updated || []);
                                    } catch (err) { toast.error(err.message); }
                                    setProcessingId(null);
                                  }}
                                >
                                  {processingId === e.escrow_id ? '...' : 'Mark Delivered'}
                                </button>
                              )}
                              {/* Buyer: confirm delivery */}
                              {isBuyer && e.status === 'Delivered' && (
                                <button
                                  className="action-btn"
                                  style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem', background: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.3)', color: '#4ade80' }}
                                  disabled={processingId === e.escrow_id}
                                  onClick={async () => {
                                    setProcessingId(e.escrow_id);
                                    try {
                                      await contractConfirmDelivery(address, e.escrow_id);
                                      toast.txSuccess('Payment released to seller!', '');
                                      const updated = await getEscrowsForUser(address);
                                      setOnChainEscrows(updated || []);
                                    } catch (err) { toast.error(err.message); }
                                    setProcessingId(null);
                                  }}
                                >
                                  {processingId === e.escrow_id ? '...' : 'Confirm & Pay'}
                                </button>
                              )}
                              {(e.status === 'Released' || e.status === 'AutoReleased' || e.status === 'Refunded' || e.status === 'Cancelled') && (
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Settled</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}



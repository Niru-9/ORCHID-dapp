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
  contractDispute,
  contractRegisterArbiter,
  contractGetArbiters,
} from '../store/escrow_contract';
import ConfirmModal from '../components/ConfirmModal';

export default function Escrow() {
  const { createEscrow, releaseEscrow, refundEscrow, disputeEscrow, autoReleaseEscrow, checkEscrowExpiry, transactions, address } = useWalletStore();
  const toast = useToast();
  
  const [seller, setSeller] = useState('');
  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState('XLM');
  const [description, setDescription] = useState('');
  const [expiryDays, setExpiryDays] = useState('7');
  const [escrowMode, setEscrowMode] = useState('A'); // 'A' = trust-minimized, 'B' = arbitration

  // 500 XLM threshold — matches contract MODE_B_THRESHOLD
  const MODE_B_THRESHOLD_XLM = 500;
  const [isCreating, setIsCreating] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  // On-chain escrows visible to this user (as buyer OR seller OR arbitrator)
  const [onChainEscrows, setOnChainEscrows] = useState([]);
  const [loadingOnChain, setLoadingOnChain] = useState(false);
  const [votingEscrow, setVotingEscrow] = useState(null);
  const [voteDecision, setVoteDecision] = useState('Release');
  const [arbiterStake, setArbiterStake] = useState('');
  const [isRegisteringArbiter, setIsRegisteringArbiter] = useState(false);
  const [availableArbiters, setAvailableArbiters] = useState([]);
  const [tab, setTab] = useState('escrows');
  const [confirmModal, setConfirmModal] = useState(null);

  // Auto-switch to Mode B when amount exceeds threshold
  useEffect(() => {
    if (parseFloat(amount) >= MODE_B_THRESHOLD_XLM && escrowMode === 'A') {
      setEscrowMode('B');
    }
  }, [amount]);

  // Fetch available arbiters on load
  useEffect(() => {
    const fetchArbiters = async () => {
      try {
        const list = await contractGetArbiters();
        setAvailableArbiters(list || []);
      } catch (_) {}
    };
    fetchArbiters();
    const t = setInterval(fetchArbiters, 30_000);
    return () => clearInterval(t);
  }, []);

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

    // Hard block: contract will reject Mode A above threshold — catch it early
    if (escrowMode === 'A' && parseFloat(amount) >= MODE_B_THRESHOLD_XLM) {
      toast.error(`Amounts ≥ ${MODE_B_THRESHOLD_XLM} XLM require Mode B. Switch mode above.`);
      return;
    }

    setIsCreating(true);
    try {
      const useArbitration = escrowMode === 'B';
      const hash = await createEscrow(seller, amount, asset, description, expiryDays, useArbitration);
      toast.txSuccess(useArbitration ? 'Escrow created — arbitrators auto-assigned' : 'Trust-minimized escrow created', hash);
      setSeller(''); setAmount(''); setDescription('');
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
    setConfirmModal({
      title: 'Force Finalize',
      message: 'Arbitration deadline has passed. This will refund the buyer. This action is irreversible.',
      confirmLabel: 'Force Finalize',
      danger: true,
      onConfirm: async () => {
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
      },
    });
  };

  const handleDispute = async (escrowId) => {
    setConfirmModal({
      title: 'Raise a Dispute',
      message: 'This will pause the escrow and require the arbitrator panel to vote.\n\nA dispute fee will be charged. Only raise a dispute if there is a genuine issue.',
      confirmLabel: 'Raise Dispute',
      danger: true,
      onConfirm: async () => {
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
      },
    });
  };

  const handleRegisterArbiter = async (e) => {
    e.preventDefault();
    if (!arbiterStake) return;
    setIsRegisteringArbiter(true);
    try {
      await contractRegisterArbiter(address, arbiterStake);
      toast.success(`Registered as arbiter with ${arbiterStake} XLM stake!`);
      setArbiterStake('');
      const list = await contractGetArbiters();
      setAvailableArbiters(list || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsRegisteringArbiter(false);
    }
  };

  const handleMarkDelivered = async (id) => {
    const tx = transactions.find(t => t.id === id);
    if (!tx) return;
    setConfirmModal({
      title: 'Confirm Delivery & Release Payment',
      message: `Marking as delivered will immediately release:\n\nAmount: ${tx.amount}\nTo: ${tx.merchant}\n\nThis is irreversible. Funds will be sent to the seller now.`,
      confirmLabel: 'Release Payment',
      danger: false,
      onConfirm: async () => {
        setProcessingId(id);
        try {
          const hash = await releaseEscrow(id);
          toast.txSuccess('Delivery confirmed! Payment sent to seller.', hash);
        } catch (err) {
          toast.error(err.message);
        } finally {
          setProcessingId(null);
        }
      },
    });
  };

  const handleRefund = async (id) => {
    const tx = transactions.find(t => t.id === id);
    if (!tx) return;
    setConfirmModal({
      title: 'Refund Authorization',
      message: `Funds will be returned to your wallet:\n\nAmount: ${tx.amount}\n\nThis action is irreversible.`,
      confirmLabel: 'Refund',
      danger: true,
      onConfirm: async () => {
        setProcessingId(id);
        try {
          const hash = await refundEscrow(id);
          toast.txSuccess('Funds refunded to your wallet!', hash);
        } catch (err) {
          toast.error(err.message);
        } finally {
          setProcessingId(null);
        }
      },
    });
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
      <ConfirmModal modal={confirmModal} onClose={() => setConfirmModal(null)} />
      <div className="view-header">
        <div>
          <div className="section-label">Secure Payments</div>
          <h2 className="view-title">Lock Funds</h2>
          <p className="view-subtitle">
            Lock funds in a smart contract. A panel of human arbitrators resolves disputes — the contract enforces their decision. No single party controls the outcome.
          </p>
        </div>
        <a href={`https://stellar.expert/explorer/testnet/contract/${import.meta.env.VITE_ESCROW_CONTRACT_ID}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-glow)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', border: '1px solid rgba(168,85,247,0.2)', padding: '0.5rem 1rem', borderRadius: '0.5rem', flexShrink: 0 }}>
          View Contract ↗
        </a>
      </div>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--glass-border)' }}>
        {[['escrows','Escrow Contracts'],['arbiters','Available Arbiters'],['become-arbiter','Become Arbiter']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding: '0.75rem 1rem', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500, color: tab === id ? 'var(--accent-glow)' : 'var(--text-muted)', borderBottom: tab === id ? '2px solid var(--accent-glow)' : '2px solid transparent' }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── BECOME ARBITER ── */}
      {tab === 'become-arbiter' && (
        <div className="grid-2">
          <div className="card">
            <h3 className="card-title">Register as Arbiter</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              Stake XLM to become a trusted arbiter. Once registered, buyers can select you as an arbitrator when creating escrows. Your stake signals commitment — arbiters with higher stakes are more trusted.
            </p>
            <div style={{ padding: '1rem', background: 'rgba(168,85,247,0.05)', borderRadius: '10px', border: '1px solid rgba(168,85,247,0.15)', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Minimum Stake</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#a855f7', marginTop: '0.25rem' }}>500 XLM</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>5,000,000,000 stroops — must exceed expected dispute gain</div>
            </div>
            <form onSubmit={handleRegisterArbiter} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="form-group">
                <label className="form-label">Stake Amount (XLM)</label>
                <input type="number" step="1" min="500" value={arbiterStake} onChange={e => setArbiterStake(e.target.value)}
                  placeholder="500" className="form-input" required disabled={isRegisteringArbiter} />
              </div>
              <button type="submit" disabled={isRegisteringArbiter || !arbiterStake} className="submit-btn">
                {isRegisteringArbiter ? 'Registering...' : 'Register as Arbiter'}
              </button>
            </form>
          </div>
          <div className="card">
            <h3 className="card-title">How Arbitration Works</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
              {[
                ['01', 'Register', 'Stake XLM to join the arbiter pool. Your address becomes eligible for auto-assignment.'],
                ['02', 'Get Assigned', 'When a buyer creates a Mode B escrow, the contract selects arbiters automatically. You cannot be hand-picked — selection is pseudo-random from the staked pool.'],
                ['03', 'Vote', 'If a dispute is raised, you vote Release (pay seller) or Refund (pay buyer). One vote per escrow.'],
                ['04', 'Finalize', 'Once majority is reached, anyone calls finalize. The contract executes — no override possible.'],
              ].map(([step, title, desc]) => (
                <div key={step} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--accent-glow)', fontWeight: 700, minWidth: '2rem', paddingTop: '0.1rem' }}>STEP {step}</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.25rem' }}>{title}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── AVAILABLE ARBITERS ── */}
      {tab === 'arbiters' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 className="card-title" style={{ margin: 0 }}>Registered Arbiters</h3>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{availableArbiters.length} registered</div>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
            These addresses have staked XLM and are eligible for auto-assignment as arbitrators. The contract selects from this pool — users cannot choose specific arbiters.
          </p>
          {availableArbiters.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No arbiters registered yet. Be the first — go to "Become Arbiter".
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead><tr><th>#</th><th>Address</th><th>Status</th></tr></thead>
                <tbody>
                  {availableArbiters.map((arb, i) => (
                    <tr key={i}>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{i + 1}</td>
                      <td className="mono" style={{ fontSize: '0.78rem' }}>{arb}</td>
                      <td>
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#4ade80', background: 'rgba(34,197,94,0.1)', padding: '0.2rem 0.5rem', borderRadius: '6px' }}>
                          Eligible
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── ESCROW CONTRACTS ── */}
      {tab === 'escrows' && (<>

      {/* How it works strip */}
      <div className="info-strip" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: '2.5rem' }}>        <div className="info-strip-item">
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.5rem' }}>STEP 01</div>
          <div className="info-strip-title">Lock Funds in Contract</div>
          <p className="info-strip-body">You deposit XLM into the Soroban escrow contract. Funds are held on-chain — not in any wallet, not by any person. Only the contract rules can release them.</p>
        </div>
        <div className="info-strip-item">
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.5rem' }}>STEP 02</div>
          <div className="info-strip-title">Seller Delivers, Buyer Confirms</div>
          <p className="info-strip-body">Seller marks delivery on-chain. Buyer confirms and funds release. Mode A: timeouts handle inaction deterministically. Mode B: either party can raise a dispute — arbitration panel votes, contract executes.</p>
        </div>
        <div className="info-strip-item">
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.5rem' }}>STEP 03</div>
          <div className="info-strip-title">Deadlines Protect Everyone</div>
          <p className="info-strip-body">If seller never delivers, buyer reclaims funds after the deadline. If buyer disappears after delivery, seller gets paid after the confirmation window. No funds locked forever.</p>
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
            
            {/* Mode selector */}
            <div className="form-group">
              <label className="form-label">Escrow Mode</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setEscrowMode('A')} style={{
                  padding: '0.875rem', borderRadius: '10px',
                  border: `1px solid ${escrowMode === 'A' ? 'rgba(201,168,87,0.5)' : '#27272A'}`,
                  background: escrowMode === 'A' ? 'rgba(201,168,87,0.08)' : 'transparent',
                  cursor: parseFloat(amount) >= MODE_B_THRESHOLD_XLM ? 'not-allowed' : 'pointer',
                  textAlign: 'left', opacity: parseFloat(amount) >= MODE_B_THRESHOLD_XLM ? 0.4 : 1,
                }} disabled={parseFloat(amount) >= MODE_B_THRESHOLD_XLM}>
                  <div style={{ fontWeight: 700, fontSize: '0.82rem', color: escrowMode === 'A' ? '#C9A857' : '#A1A1AA', marginBottom: '0.25rem' }}>Mode A — Trust-Minimized</div>
                  <div style={{ fontSize: '0.72rem', color: '#71717a', lineHeight: 1.5 }}>
                    No arbitrators. Deterministic timeouts only.
                    {parseFloat(amount) >= MODE_B_THRESHOLD_XLM
                      ? <span style={{ color: '#ef4444', display: 'block', marginTop: '0.25rem' }}>Disabled above {MODE_B_THRESHOLD_XLM} XLM</span>
                      : <span style={{ color: '#f59e0b', display: 'block', marginTop: '0.25rem' }}>Risk: wrong outcomes possible if you miss deadlines</span>
                    }
                  </div>
                </button>
                <button type="button" onClick={() => setEscrowMode('B')} style={{
                  padding: '0.875rem', borderRadius: '10px',
                  border: `1px solid ${escrowMode === 'B' ? 'rgba(168,85,247,0.5)' : parseFloat(amount) >= MODE_B_THRESHOLD_XLM ? 'rgba(168,85,247,0.4)' : '#27272A'}`,
                  background: escrowMode === 'B' ? 'rgba(168,85,247,0.06)' : parseFloat(amount) >= MODE_B_THRESHOLD_XLM ? 'rgba(168,85,247,0.04)' : 'transparent',
                  cursor: 'pointer', textAlign: 'left',
                }}>
                  <div style={{ fontWeight: 700, fontSize: '0.82rem', color: escrowMode === 'B' ? '#a855f7' : '#A1A1AA', marginBottom: '0.25rem' }}>
                    Mode B — Arbitration
                    {parseFloat(amount) >= MODE_B_THRESHOLD_XLM && <span style={{ color: '#f59e0b', fontSize: '0.65rem', marginLeft: '0.4rem' }}>REQUIRED</span>}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#71717a', lineHeight: 1.5 }}>Human panel resolves disputes. All arbitrators must be registered with stake.</div>
                </button>
              </div>
            </div>

            {/* Arbitrator Panel — Mode B only */}
            {escrowMode === 'B' && (
              <div style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: '10px', padding: '1rem' }}>
                <div style={{ fontSize: '0.72rem', color: '#a855f7', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.5rem' }}>Auto-Assignment</div>
                <div style={{ fontSize: '0.85rem', color: '#F5F5F5', fontWeight: 600, marginBottom: '0.35rem' }}>
                  {parseFloat(amount) >= 2000 ? '7 arbitrators' : parseFloat(amount) >= 500 ? '5 arbitrators' : '3 arbitrators'} will be assigned
                </div>
                <div style={{ fontSize: '0.78rem', color: '#71717a', lineHeight: 1.6 }}>
                  The contract selects arbitrators automatically from the staked pool. You cannot choose them — this prevents collusion. Panel is locked at creation.
                </div>
                {availableArbiters.length > 0 && (
                  <div style={{ fontSize: '0.72rem', color: '#C9A857', marginTop: '0.5rem' }}>
                    {availableArbiters.length} registered arbiter{availableArbiters.length !== 1 ? 's' : ''} in pool
                  </div>
                )}
                {availableArbiters.length < (parseFloat(amount) >= 2000 ? 7 : parseFloat(amount) >= 500 ? 5 : 3) && (
                  <div style={{ fontSize: '0.72rem', color: '#ef4444', marginTop: '0.35rem' }}>
                    ⚠ Pool may be too small — contract will reject if fewer than {parseFloat(amount) >= 2000 ? 7 : parseFloat(amount) >= 500 ? 5 : 3} eligible arbiters exist
                  </div>
                )}
              </div>
            )}
            
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
              {isCreating ? 'Creating Escrow...' : escrowMode === 'B' ? 'Lock Funds + Enable Arbitration' : 'Lock Funds (Trust-Minimized)'}
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
                                      setConfirmModal({
                                        title: 'Request Refund',
                                        message: 'Request a refund? The buyer will need to approve it on-chain.',
                                        confirmLabel: 'Request Refund',
                                        danger: false,
                                        onConfirm: async () => {
                                          setProcessingId(tx.id);
                                          try {
                                            await useWalletStore.getState().requestEscrowRefund(tx.id);
                                            toast.success('Refund requested. Awaiting buyer approval.');
                                          } catch (err) { toast.error(err.message); }
                                          finally { setProcessingId(null); }
                                        },
                                      });
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
                      <th>Mode</th>
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
                            <span style={{ padding: '0.2rem 0.5rem', borderRadius: '6px', fontSize: '0.65rem', fontWeight: 700, background: e.arbitrators?.length > 0 ? 'rgba(168,85,247,0.1)' : 'rgba(201,168,87,0.08)', color: e.arbitrators?.length > 0 ? '#a855f7' : '#C9A857' }}>
                              {e.arbitrators?.length > 0 ? 'Mode B' : 'Mode A'}
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
                              {/* Buyer: cancel while Funded */}
                              {isBuyer && e.status === 'Funded' && (
                                <button
                                  className="action-btn"
                                  style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }}
                                  disabled={processingId === e.escrow_id}
                                  onClick={() => setConfirmModal({
                                    title: 'Cancel Escrow',
                                    message: 'Cancel this escrow and refund your wallet. Only possible before seller marks delivered.',
                                    confirmLabel: 'Cancel & Refund',
                                    danger: true,
                                    onConfirm: async () => {
                                      setProcessingId(e.escrow_id);
                                      try {
                                        const { contractCancel } = await import('../store/escrow_contract.js');
                                        await contractCancel(address, e.escrow_id);
                                        toast.txSuccess('Escrow cancelled. Funds refunded.', '');
                                        const updated = await getEscrowsForUser(address);
                                        setOnChainEscrows(updated || []);
                                      } catch (err) { toast.error(err.message); }
                                      setProcessingId(null);
                                    },
                                  })}
                                >
                                  Cancel
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
                              {/* Either party: dispute while Funded or Delivered */}
                              {(e.status === 'Funded' || e.status === 'Delivered') && (
                                <button
                                  className="action-btn"
                                  style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem', borderColor: 'rgba(239,68,68,0.2)', color: '#f87171' }}
                                  disabled={processingId === e.escrow_id}
                                  onClick={() => handleDispute(e.escrow_id)}
                                >
                                  Dispute
                                </button>
                              )}
                              {/* Arbitrator: vote on disputed escrow */}
                              {e.status === 'Disputed' && e.arbitrators?.includes(address) && (
                                <div style={{ display: 'flex', gap: '0.35rem' }}>
                                  <button className="action-btn" style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem', background: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.3)', color: '#4ade80' }}
                                    disabled={processingId === e.escrow_id}
                                    onClick={() => handleVote(e.escrow_id, 'Release')}>
                                    Vote Release
                                  </button>
                                  <button className="action-btn" style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }}
                                    disabled={processingId === e.escrow_id}
                                    onClick={() => handleVote(e.escrow_id, 'Refund')}>
                                    Vote Refund
                                  </button>
                                </div>
                              )}
                              {/* Anyone: finalize after majority */}
                              {e.status === 'Disputed' && (e.votes_release > 0 || e.votes_refund > 0) && (
                                <button className="action-btn" style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem', background: 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.3)', color: '#a855f7' }}
                                  disabled={processingId === e.escrow_id}
                                  onClick={() => handleFinalize(e.escrow_id)}>
                                  Finalize
                                </button>
                              )}
        {/* Settled states */}
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
      </>)}
    </motion.div>
  );
}



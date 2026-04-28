import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useWalletStore } from '../store/wallet';
import { useToast } from '../components/Toast';
import {
  contractGetArbiters,
  contractGetArbiterStake,
  contractRegisterArbiter,
  contractVote,
  contractFinalize,
  contractForceFinalize,
  getEscrowsForUser,
  contractGetActiveEscrows,
  contractSlashInactive,
  contractSlashMinority,
  contractDistributeRewards,
  contractRequestUnstake,
  contractClaimUnstake,
  contractGetArbiterStats,
  contractGetUnstakeAt,
  contractGetArbiterReputation,
  contractGetArbiterMinorityVotes,
} from '../store/escrow_contract';
import ConfirmModal from '../components/ConfirmModal';
import { Scale, ShieldCheck, AlertTriangle, Clock, CheckCircle2, Users, Gavel } from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAddr(a) { return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '—'; }
function fmtXlm(stroops) { return (Number(stroops) / 1e7).toFixed(2); }
function fmtDeadline(ts) {
  if (!ts || ts === 0) return '—';
  const d = new Date(Number(ts) * 1000);
  const diff = d - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`;
}

const STATUS_COLORS = {
  Funded:      { bg: 'rgba(56,189,248,0.1)',  color: '#38bdf8' },
  Delivered:   { bg: 'rgba(234,179,8,0.1)',   color: '#eab308' },
  Disputed:    { bg: 'rgba(239,68,68,0.12)',  color: '#f87171' },
  Released:    { bg: 'rgba(34,197,94,0.1)',   color: '#4ade80' },
  AutoReleased:{ bg: 'rgba(34,197,94,0.1)',   color: '#4ade80' },
  Refunded:    { bg: 'rgba(168,85,247,0.1)',  color: '#a855f7' },
  Cancelled:   { bg: 'rgba(113,113,122,0.1)', color: '#71717a' },
};

export default function Arbitration() {
  const { address } = useWalletStore();
  const toast = useToast();

  const [tab, setTab] = useState('queue');
  const [myStake, setMyStake] = useState(null);
  const [stakeInput, setStakeInput] = useState('');
  const [registering, setRegistering] = useState(false);
  const [myStats, setMyStats] = useState(null);
  const [myReputation, setMyReputation] = useState(null);
  const [unstakeAt, setUnstakeAt] = useState(0);
  const [unstaking, setUnstaking] = useState(false);
  const [allArbiters, setAllArbiters] = useState([]);
  const [disputedEscrows, setDisputedEscrows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  const isRegistered = myStake !== null && myStake > 0;

  // ── Load data ──────────────────────────────────────────────────────────────
  const refresh = async () => {
    if (!address) return;
    setLoading(true);
    try {
      const [stake, arbiters, active, stats, unstake, rep] = await Promise.all([
        contractGetArbiterStake(address).catch(() => 0),
        contractGetArbiters().catch(() => []),
        contractGetActiveEscrows().catch(() => []),
        contractGetArbiterStats(address).catch(() => null),
        contractGetUnstakeAt(address).catch(() => 0),
        contractGetArbiterReputation(address).catch(() => null),
      ]);
      setMyStake(stake ?? 0);
      setAllArbiters(arbiters ?? []);
      const disputed = (active ?? []).filter(e => e.status === 'Disputed');
      setDisputedEscrows(disputed);
      if (stats) setMyStats({ total: stats[0] ?? 0, missed: stats[1] ?? 0 });
      setUnstakeAt(Number(unstake ?? 0));
      if (rep !== null) setMyReputation(Number(rep));
    } catch (_) {}
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [address]);
  useEffect(() => { const t = setInterval(refresh, 30_000); return () => clearInterval(t); }, [address]);

  // ── My dispute queue: disputed escrows where I am an arbitrator ────────────
  const myQueue = disputedEscrows.filter(e =>
    Array.isArray(e.arbitrators) && e.arbitrators.includes(address)
  );

  // ── All disputed escrows (for overview) ───────────────────────────────────
  const allDisputed = disputedEscrows;

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleRegister = async (e) => {
    e.preventDefault();
    if (!stakeInput) return;
    setRegistering(true);
    try {
      await contractRegisterArbiter(address, stakeInput);
      toast.success(`Registered as arbiter with ${stakeInput} XLM stake`);
      setStakeInput('');
      await refresh();
    } catch (err) { toast.error(err.message); }
    setRegistering(false);
  };

  const handleVote = (escrow, decision) => {
    setConfirmModal({
      title: `Vote: ${decision}`,
      message: `You are voting to ${decision === 'Release' ? 'release funds to the seller' : 'refund the buyer'} for escrow #${escrow.escrow_id}.\n\nAmount: ${fmtXlm(escrow.amount)} XLM\n\nThis vote is final and on-chain.`,
      confirmLabel: `Vote ${decision}`,
      danger: decision === 'Refund',
      onConfirm: async () => {
        setProcessingId(escrow.escrow_id);
        try {
          await contractVote(address, escrow.escrow_id, decision);
          toast.success(`Vote cast: ${decision}`);
          await refresh();
        } catch (err) { toast.error(err.message); }
        setProcessingId(null);
      },
    });
  };

  const handleFinalize = (escrow) => {
    setConfirmModal({
      title: 'Finalize Dispute',
      message: `Majority has been reached for escrow #${escrow.escrow_id}.\n\nRelease votes: ${escrow.votes_release}  |  Refund votes: ${escrow.votes_refund}\n\nThis will execute the decision on-chain.`,
      confirmLabel: 'Finalize',
      danger: false,
      onConfirm: async () => {
        setProcessingId(escrow.escrow_id);
        try {
          await contractFinalize(address, escrow.escrow_id);
          toast.txSuccess('Dispute finalized', '');
          await refresh();
        } catch (err) { toast.error(err.message); }
        setProcessingId(null);
      },
    });
  };

  const handleForceFinalize = (escrow) => {
    setConfirmModal({
      title: 'Force Finalize',
      message: `Arbitration deadline has passed for escrow #${escrow.escrow_id}.\n\nThis will refund the buyer. Irreversible.`,
      confirmLabel: 'Force Finalize',
      danger: true,
      onConfirm: async () => {
        setProcessingId(escrow.escrow_id);
        try {
          await contractForceFinalize(address, escrow.escrow_id);
          toast.txSuccess('Force finalized — buyer refunded', '');
          await refresh();
        } catch (err) { toast.error(err.message); }
        setProcessingId(null);
      },
    });
  };

  const handleSlashAndReward = async (escrow) => {
    setProcessingId(escrow.escrow_id);
    try {
      // Order is enforced by contract: slash must run before distribute_rewards.
      // Each is idempotent — safe to call even if already executed (will revert silently).
      await contractSlashInactive(address, escrow.escrow_id).catch(() => {});
      await contractSlashMinority(address, escrow.escrow_id).catch(() => {});
      await contractDistributeRewards(address, escrow.escrow_id);
      toast.success('Slashing and rewards distributed');
      await refresh();
    } catch (err) { toast.error(err.message); }
    setProcessingId(null);
  };

  const handleRequestUnstake = async () => {
    setUnstaking(true);
    try {
      await contractRequestUnstake(address);
      toast.success('Unstake requested — 7-day cooldown started');
      await refresh();
    } catch (err) { toast.error(err.message); }
    setUnstaking(false);
  };

  const handleClaimUnstake = async () => {
    setUnstaking(true);
    try {
      await contractClaimUnstake(address);
      toast.success('Stake returned to your wallet');
      await refresh();
    } catch (err) { toast.error(err.message); }
    setUnstaking(false);
  };

  const unstakeCooldownRemaining = () => {
    if (!unstakeAt) return null;
    const diff = unstakeAt * 1000 - Date.now();
    if (diff <= 0) return 'Ready to claim';
    const d = Math.floor(diff / 86_400_000);
    const h = Math.floor((diff % 86_400_000) / 3_600_000);
    return `${d}d ${h}h remaining`;
  };

  // ── Majority check ─────────────────────────────────────────────────────────
  const hasMajority = (e) => {
    const majority = Math.floor(e.arbitrators?.length / 2) + 1;
    return e.votes_release >= majority || e.votes_refund >= majority;
  };

  const deadlinePassed = (e) => {
    if (!e.dispute_deadline || e.dispute_deadline === 0) return false;
    return Date.now() / 1000 >= Number(e.dispute_deadline);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <ConfirmModal modal={confirmModal} onClose={() => setConfirmModal(null)} />

      <div className="view-header">
        <div>
          <div className="section-label">Human Arbitration</div>
          <h2 className="view-title">Arbitration Panel</h2>
          <p className="view-subtitle">
            Disputes are resolved by human arbitrators. The contract enforces the majority vote — no single party controls the outcome.
          </p>
        </div>
        {isRegistered && (
          <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '10px', padding: '0.75rem 1.25rem', textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '0.68rem', color: '#71717a', textTransform: 'uppercase', fontWeight: 700 }}>Your Stake</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#4ade80' }}>{fmtXlm(myStake)} XLM</div>
            {myReputation !== null && (
              <div style={{ fontSize: '0.72rem', color: myReputation >= 0 ? '#4ade80' : '#f87171', marginTop: '0.2rem' }}>
                Rep: {myReputation >= 0 ? '+' : ''}{myReputation}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Stats row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        {[
          { icon: Gavel,       label: 'Open Disputes',    value: allDisputed.length,  color: '#f87171' },
          { icon: Scale,       label: 'My Queue',         value: myQueue.length,      color: '#eab308' },
          { icon: Users,       label: 'Registered Arbiters', value: allArbiters.length, color: '#60a5fa' },
          { icon: ShieldCheck, label: 'My Stake',         value: isRegistered ? `${fmtXlm(myStake)} XLM` : 'Not registered', color: isRegistered ? '#4ade80' : '#71717a' },
        ].map((s, i) => (
          <div key={i} style={{ background: '#1C1C1F', border: '1px solid #27272A', borderRadius: '12px', padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <s.icon size={14} color={s.color} />
              <span style={{ fontSize: '0.68rem', color: '#71717a', textTransform: 'uppercase', fontWeight: 700 }}>{s.label}</span>
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', borderBottom: '1px solid #27272A' }}>
        {[
          ['queue',    'My Vote Queue',    myQueue.length],
          ['all',      'All Disputes',     allDisputed.length],
          ['register', 'Register / Stake', null],
          ['arbiters', 'Arbiter Registry', allArbiters.length],
        ].map(([id, label, count]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '0.75rem 1rem', background: 'none', border: 'none', cursor: 'pointer',
            fontWeight: 500, fontSize: '0.875rem',
            color: tab === id ? '#C9A857' : '#71717a',
            borderBottom: tab === id ? '2px solid #C9A857' : '2px solid transparent',
            display: 'flex', alignItems: 'center', gap: '0.4rem',
          }}>
            {label}
            {count !== null && count > 0 && (
              <span style={{ background: tab === id ? 'rgba(201,168,87,0.15)' : 'rgba(113,113,122,0.15)', color: tab === id ? '#C9A857' : '#71717a', borderRadius: '999px', padding: '0.1rem 0.45rem', fontSize: '0.68rem', fontWeight: 700 }}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── MY VOTE QUEUE ── */}
      {tab === 'queue' && (
        <div>
          {loading && <div style={{ color: '#71717a', fontSize: '0.85rem', marginBottom: '1rem' }}>Syncing from chain...</div>}
          {!isRegistered && (
            <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '10px', padding: '1rem 1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <AlertTriangle size={16} color="#f59e0b" />
              <span style={{ fontSize: '0.85rem', color: '#fbbf24' }}>You are not registered as an arbiter. Go to "Register / Stake" to join the panel.</span>
            </div>
          )}
          {myQueue.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#71717a' }}>
              <Scale size={32} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
              <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>No disputes in your queue</div>
              <div style={{ fontSize: '0.82rem' }}>You will appear here when the protocol assigns you to a dispute based on your stake, reputation, and randomness.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {myQueue.map((e) => <DisputeCard key={e.escrow_id} e={e} address={address} processingId={processingId} onVote={handleVote} onFinalize={handleFinalize} onForceFinalize={handleForceFinalize} onSlashReward={handleSlashAndReward} hasMajority={hasMajority} deadlinePassed={deadlinePassed} />)}
            </div>
          )}
        </div>
      )}

      {/* ── ALL DISPUTES ── */}
      {tab === 'all' && (
        <div>
          {loading && <div style={{ color: '#71717a', fontSize: '0.85rem', marginBottom: '1rem' }}>Syncing from chain...</div>}
          {allDisputed.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#71717a' }}>
              <CheckCircle2 size={32} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
              <div style={{ fontWeight: 600 }}>No open disputes</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {allDisputed.map((e) => <DisputeCard key={e.escrow_id} e={e} address={address} processingId={processingId} onVote={handleVote} onFinalize={handleFinalize} onForceFinalize={handleForceFinalize} onSlashReward={handleSlashAndReward} hasMajority={hasMajority} deadlinePassed={deadlinePassed} />)}
            </div>
          )}
        </div>
      )}

      {/* ── REGISTER ── */}
      {tab === 'register' && (
        <div className="grid-2">
          <div className="card">
            <h3 className="card-title">{isRegistered ? 'Add More Stake' : 'Register as Arbiter'}</h3>
            <p style={{ fontSize: '0.85rem', color: '#71717a', marginBottom: '1.5rem', lineHeight: 1.7 }}>
              Stake XLM to join the arbiter pool. The protocol assigns arbitrators based on stake, reputation, and randomness — you cannot be hand-picked. Selection is probabilistic and cannot be influenced by users. Pool capped at 75 arbiters. Max 25% stake concentration per arbiter.
            </p>
            {isRegistered && (
              <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '8px', padding: '0.875rem', marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '0.7rem', color: '#71717a', textTransform: 'uppercase', fontWeight: 700 }}>Current Stake</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#4ade80', marginTop: '0.25rem' }}>{fmtXlm(myStake)} XLM</div>
              </div>
            )}
            <div style={{ background: 'rgba(201,168,87,0.06)', border: '1px solid rgba(201,168,87,0.15)', borderRadius: '8px', padding: '0.875rem', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.7rem', color: '#71717a', textTransform: 'uppercase', fontWeight: 700 }}>Minimum Stake</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#C9A857', marginTop: '0.25rem' }}>500 XLM</div>
              <div style={{ fontSize: '0.72rem', color: '#71717a', marginTop: '0.2rem' }}>5,000,000,000 stroops — must exceed expected dispute gain</div>
            </div>
            <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label className="form-label">Stake Amount (XLM)</label>
                <input type="number" step="1" min="500" value={stakeInput} onChange={e => setStakeInput(e.target.value)}
                  placeholder="500" className="form-input" required disabled={registering} style={{ marginTop: '0.5rem' }} />
              </div>
              <button type="submit" disabled={registering || !stakeInput} className="submit-btn">
                {registering ? <div className="spinner" /> : isRegistered ? 'Add Stake' : 'Register as Arbiter'}
              </button>
            </form>

            {/* Unstake section — only shown if registered */}
            {isRegistered && (
              <div style={{ marginTop: '1.5rem', borderTop: '1px solid #27272A', paddingTop: '1.25rem' }}>
                <div style={{ fontSize: '0.72rem', color: '#71717a', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.75rem' }}>Unstake</div>
                {myStats && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
                    <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '0.75rem' }}>
                      <div style={{ fontSize: '0.65rem', color: '#71717a', fontWeight: 700 }}>ASSIGNED</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#F5F5F5' }}>{myStats.total}</div>
                    </div>
                    <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '0.75rem' }}>
                      <div style={{ fontSize: '0.65rem', color: '#71717a', fontWeight: 700 }}>MISSED</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: myStats.missed > 0 ? '#f87171' : '#4ade80' }}>{myStats.missed}</div>
                    </div>
                  </div>
                )}
                {unstakeAt > 0 ? (
                  <div>
                    <div style={{ fontSize: '0.78rem', color: '#f59e0b', marginBottom: '0.75rem' }}>
                      Cooldown: {unstakeCooldownRemaining()}
                    </div>
                    <button className="action-btn" disabled={unstaking || Date.now() < unstakeAt * 1000}
                      style={{ borderColor: 'rgba(34,197,94,0.3)', color: '#4ade80', width: '100%', justifyContent: 'center' }}
                      onClick={handleClaimUnstake}>
                      {unstaking ? <div className="spinner" style={{ width: 14, height: 14 }} /> : 'Claim Unstake'}
                    </button>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '0.75rem', lineHeight: 1.6 }}>
                      7-day cooldown required. Prevents stake withdrawal during active dispute assignment.
                    </div>
                    <button className="action-btn" disabled={unstaking}
                      style={{ borderColor: 'rgba(239,68,68,0.3)', color: '#f87171', width: '100%', justifyContent: 'center' }}
                      onClick={handleRequestUnstake}>
                      {unstaking ? <div className="spinner" style={{ width: 14, height: 14 }} /> : 'Request Unstake'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="card">
            <h3 className="card-title">Arbitration Rules</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '0.5rem' }}>
              {[
                ['01', 'Protocol assigns you', 'When a dispute is raised on a Mode B escrow, the protocol assigns arbitrators based on stake, reputation, and randomness. Selection is probabilistic and cannot be influenced by users.'],
                ['02', 'Vote on disputed escrows', 'When a dispute is raised, you vote Release (pay seller) or Refund (pay buyer). One vote per escrow.'],
                ['03', 'Majority executes', 'Once majority is reached, anyone calls finalize. The contract executes the decision — no override possible.'],
                ['04', 'Earn rewards', 'Majority voters split the dispute fee pool. Minority voters lose 20% stake. Note: minority ≠ dishonest — this is a coordination mechanism, not a truth guarantee. Honest disagreement can still be penalized.'],
                ['05', 'Unstake with cooldown', '7-day cooldown on unstaking. Prevents stake withdrawal immediately after dispute assignment.'],
              ].map(([step, title, desc]) => (
                <div key={step} style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ fontSize: '0.65rem', color: '#C9A857', fontWeight: 700, minWidth: '2.5rem', paddingTop: '0.1rem' }}>STEP {step}</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>{title}</div>
                    <div style={{ fontSize: '0.8rem', color: '#71717a', lineHeight: 1.6 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── ARBITER REGISTRY ── */}
      {tab === 'arbiters' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 className="card-title" style={{ margin: 0 }}>Registered Arbiters</h3>
            <span style={{ fontSize: '0.75rem', color: '#71717a' }}>{allArbiters.length} registered</span>
          </div>
          <p style={{ fontSize: '0.82rem', color: '#71717a', marginBottom: '1.25rem', lineHeight: 1.6 }}>
            These addresses have staked XLM and are eligible to be selected as arbitrators. Copy an address to use it when creating an escrow.
          </p>
          {allArbiters.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#71717a', fontSize: '0.85rem' }}>
              No arbiters registered yet. Be the first.
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead><tr><th>#</th><th>Address</th><th>Action</th></tr></thead>
                <tbody>
                  {allArbiters.map((arb, i) => (
                    <tr key={i}>
                      <td style={{ color: '#71717a', fontSize: '0.8rem' }}>{i + 1}</td>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.78rem' }}>{arb}</td>
                      <td>
                        <button className="action-btn" style={{ fontSize: '0.7rem', padding: '0.3rem 0.6rem' }}
                          onClick={() => { navigator.clipboard.writeText(arb); toast.success('Address copied'); }}>
                          Copy
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ── DisputeCard ───────────────────────────────────────────────────────────────
function DisputeCard({ e, address, processingId, onVote, onFinalize, onForceFinalize, onSlashReward, hasMajority, deadlinePassed }) {
  const panelSize = e.arbitrators?.length ?? 1;
  const majority = Math.floor(panelSize / 2) + 1;
  const totalVotes = (e.votes_release ?? 0) + (e.votes_refund ?? 0);
  const isMyEscrow = Array.isArray(e.arbitrators) && e.arbitrators.includes(address);
  const canFinalize = hasMajority(e);
  const canForce = deadlinePassed(e);
  const busy = processingId === e.escrow_id;

  return (
    <div style={{ background: '#1C1C1F', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '12px', padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Gavel size={16} color="#f87171" />
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: '#C9A857' }}>Escrow #{e.escrow_id}</span>
          {isMyEscrow && (
            <span style={{ background: 'rgba(201,168,87,0.12)', color: '#C9A857', borderRadius: '999px', padding: '0.15rem 0.5rem', fontSize: '0.65rem', fontWeight: 700 }}>YOUR PANEL</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Clock size={13} color="#71717a" />
          <span style={{ fontSize: '0.78rem', color: canForce ? '#ef4444' : '#71717a' }}>
            {canForce ? 'Deadline passed' : `Deadline: ${fmtDeadline(e.dispute_deadline)}`}
          </span>
        </div>
      </div>

      {/* Parties */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
        <div style={{ background: 'rgba(59,130,246,0.06)', borderRadius: '8px', padding: '0.75rem' }}>
          <div style={{ fontSize: '0.65rem', color: '#71717a', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.25rem' }}>Buyer</div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.78rem', color: '#60a5fa' }}>{fmtAddr(e.buyer)}</div>
        </div>
        <div style={{ background: 'rgba(34,197,94,0.06)', borderRadius: '8px', padding: '0.75rem' }}>
          <div style={{ fontSize: '0.65rem', color: '#71717a', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.25rem' }}>Seller</div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.78rem', color: '#4ade80' }}>{fmtAddr(e.seller)}</div>
        </div>
      </div>

      {/* Amount + vote tally */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <div style={{ fontSize: '0.68rem', color: '#71717a', textTransform: 'uppercase', fontWeight: 700 }}>Amount at stake</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#F5F5F5' }}>{fmtXlm(e.amount)} XLM</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.68rem', color: '#71717a', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.35rem' }}>
            Votes ({totalVotes}/{panelSize}) — need {majority}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <span style={{ background: 'rgba(34,197,94,0.1)', color: '#4ade80', borderRadius: '6px', padding: '0.25rem 0.6rem', fontSize: '0.8rem', fontWeight: 700 }}>
              ✓ Release: {e.votes_release ?? 0}
            </span>
            <span style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', borderRadius: '6px', padding: '0.25rem 0.6rem', fontSize: '0.8rem', fontWeight: 700 }}>
              ↩ Refund: {e.votes_refund ?? 0}
            </span>
          </div>
        </div>
      </div>

      {/* Vote progress bar */}
      <div style={{ height: '6px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', height: '100%' }}>
          <div style={{ width: `${((e.votes_release ?? 0) / panelSize) * 100}%`, background: '#4ade80', transition: 'width 0.4s' }} />
          <div style={{ width: `${((e.votes_refund ?? 0) / panelSize) * 100}%`, background: '#f87171', transition: 'width 0.4s' }} />
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {isMyEscrow && !canFinalize && !canForce && (
          <>
            <button className="action-btn" disabled={busy}
              style={{ background: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.3)', color: '#4ade80', fontWeight: 600 }}
              onClick={() => onVote(e, 'Release')}>
              {busy ? '...' : '✓ Vote Release'}
            </button>
            <button className="action-btn" disabled={busy}
              style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)', color: '#f87171', fontWeight: 600 }}
              onClick={() => onVote(e, 'Refund')}>
              {busy ? '...' : '↩ Vote Refund'}
            </button>
          </>
        )}
        {canFinalize && (
          <button className="action-btn" disabled={busy}
            style={{ background: 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.3)', color: '#a855f7', fontWeight: 600 }}
            onClick={() => onFinalize(e)}>
            {busy ? '...' : '⚡ Finalize Dispute'}
          </button>
        )}
        {canForce && !canFinalize && (
          <button className="action-btn" disabled={busy}
            style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)', color: '#f87171', fontWeight: 600 }}
            onClick={() => onForceFinalize(e)}>
            {busy ? '...' : '⏱ Force Finalize (Deadline Passed)'}
          </button>
        )}
        {!isMyEscrow && !canFinalize && !canForce && (
          <span style={{ fontSize: '0.78rem', color: '#71717a', fontStyle: 'italic' }}>You are not on this arbitration panel</span>
        )}
        {/* Slash + reward — permissionless, available after resolution */}
        {(e.status === 'Released' || e.status === 'Refunded') && (
          <button className="action-btn" disabled={busy}
            style={{ background: 'rgba(201,168,87,0.08)', borderColor: 'rgba(201,168,87,0.3)', color: '#C9A857', fontWeight: 600 }}
            onClick={() => onSlashReward(e)}>
            {busy ? '...' : '⚡ Slash + Distribute Rewards'}
          </button>
        )}
      </div>
    </div>
  );
}

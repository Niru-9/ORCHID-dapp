import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useWalletStore } from '../store/wallet';
import { useToast } from '../components/Toast';
import {
  contractGetArbiters,
  contractGetArbiterStake,
  contractRegisterArbiter,
  contractVote,
  contractGetActiveEscrows,
  contractGetEscrow,
  contractResolveDispute,
  contractGetResolutionSummary,
  contractRequestUnstake,
  contractClaimUnstake,
  contractGetArbiterStats,
  contractGetUnstakeAt,
  contractGetArbiterReputation,
  contractGetSystemHealth,
  contractGetDisputeSpikeStatus,
  signalResolutionIntent,
  getResolutionIntent,
  trackResolutionExecution,
  getUserStats,
} from '../store/escrow_contract';
import ConfirmModal from '../components/ConfirmModal';
import { Scale, ShieldCheck, AlertTriangle, Clock, CheckCircle2, Users, Gavel, Activity } from 'lucide-react';

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
  const [lastReward, setLastReward] = useState(null); // { escrowId, amount }
  const [systemHealth, setSystemHealth] = useState(null); // [pool_size, eligible, dispute_count, paused]
  const [spikeStatus, setSpikeStatus] = useState(null);   // [count, window_start]
  const [cooldownIds, setCooldownIds] = useState(new Set()); // escrow IDs in post-click cooldown
  const [activeResolve, setActiveResolve] = useState(false); // global throttle: only 1 resolve at a time
  // intentMap: escrow_id → { caller, timestamp, intent_count, expires_in_ms, highly_contested, success_chance, reliability_score }
  // Populated by polling on refresh. Advisory only — never blocks contract execution.
  const [intentMap, setIntentMap] = useState({});
  const [myUserStats, setMyUserStats] = useState(null); // PHASE 8: Full user statistics

  const isRegistered = myStake !== null && myStake > 0;

  // ── Load data ──────────────────────────────────────────────────────────────
  const refresh = async () => {
    if (!address) return;
    setLoading(true);
    try {
      const [stake, arbiters, active, stats, unstake, rep, health, spike, userStats] = await Promise.all([
        contractGetArbiterStake(address).catch(() => 0),
        contractGetArbiters().catch(() => []),
        contractGetActiveEscrows().catch(() => []),
        contractGetArbiterStats(address).catch(() => null),
        contractGetUnstakeAt(address).catch(() => 0),
        contractGetArbiterReputation(address).catch(() => null),
        contractGetSystemHealth().catch(() => null),
        contractGetDisputeSpikeStatus().catch(() => null),
        getUserStats(address).catch(() => null), // PHASE 8
      ]);
      setMyStake(stake ?? 0);
      setAllArbiters(arbiters ?? []);
      const disputed = (active ?? []).filter(e => e.status === 'Disputed');
      setDisputedEscrows(disputed);
      if (stats) setMyStats({ total: stats[0] ?? 0, missed: stats[1] ?? 0 });
      setUnstakeAt(Number(unstake ?? 0));
      if (rep !== null) setMyReputation(Number(rep));
      if (health) setSystemHealth(health);
      if (spike) setSpikeStatus(spike);
      if (userStats) setMyUserStats(userStats); // PHASE 8

      // Fetch intent state for all disputed escrows (advisory coordination)
      // Fire-and-forget — failures are silent, intentMap stays stale rather than crashing
      const disputedList = (active ?? []).filter(e => e.status === 'Disputed');
      if (disputedList.length > 0) {
        Promise.all(
          disputedList.map(e =>
            getResolutionIntent(e.escrow_id).catch(() => null)
          )
        ).then(results => {
          const map = {};
          results.forEach((r, i) => {
            if (r?.intent) map[disputedList[i].escrow_id] = {
              caller:            r.intent.caller,
              is_arbiter:        r.intent.is_arbiter ?? false,
              timestamp:         r.intent.timestamp,
              unique_callers:    r.unique_callers ?? 1,
              highly_contested:  r.highly_contested ?? false,
              expires_in_ms:     r.expires_in_ms ?? 0,
              in_priority_window: r.in_priority_window ?? false,
              priority_remaining_ms: r.priority_remaining_ms ?? 0,
              priority_window_secs: r.priority_window_secs ?? 8,
              success_chance:    r.success_chance ?? 'MEDIUM',
              reliability_score: r.reliability_score ?? 'UNKNOWN', // PHASE 8
              low_reliability:   r.low_reliability ?? false, // PHASE 8
            };
          });
          setIntentMap(map);
        });
      } else {
        setIntentMap({});
      }
    } catch (_) {}
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [address]);
  useEffect(() => { const t = setInterval(refresh, 30_000); return () => clearInterval(t); }, [address]);

  // ── Constants ─────────────────────────────────────────────────────────────
  const MIN_FLOOR     = 500_000;   // 0.05 XLM — minimum resolver reward floor
  const GAS_THRESHOLD = 1_000_000; // 0.1 XLM  — estimated Soroban tx fee ceiling

  // ── Competition level heuristic ───────────────────────────────────────────
  // Based purely on reward size — higher reward attracts more bots/users.
  // Used for display, sorting, and modal warnings. No fake probability shown.
  const competitionLevel = (reward) => {
    if (reward > GAS_THRESHOLD * 2) return 'HIGH';
    if (reward > GAS_THRESHOLD)     return 'MEDIUM';
    return 'LOW';
  };
  const competitionMeta = {
    HIGH:   { label: 'High competition',     color: '#f87171', bg: 'rgba(239,68,68,0.1)'  },
    MEDIUM: { label: 'Moderate competition', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
    LOW:    { label: 'Low competition',      color: '#4ade80', bg: 'rgba(34,197,94,0.1)'  },
  };

  // ── Reward + score helpers ────────────────────────────────────────────────
  const calcReward = (e) => {
    const pool = Number(e.dispute_fee_pool || 0);
    const pct  = Math.floor(pool * 500 / 10_000);
    return pool > 0 ? Math.min(pool, Math.max(pct, MIN_FLOOR)) : 0;
  };

  // Sort score = profit / (1 + competition_factor)
  // Spreads users across disputes — high-competition disputes rank lower.
  const calcScore = (e) => {
    const reward = calcReward(e);
    const profit = reward - GAS_THRESHOLD;
    const level  = competitionLevel(reward);
    const factor = level === 'HIGH' ? 1.5 : level === 'MEDIUM' ? 0.5 : 0;
    return profit / (1 + factor);
  };

  // ── My dispute queue: disputed escrows where I am an arbitrator ────────────
  const myQueue = disputedEscrows
    .filter(e => Array.isArray(e.arbitrators) && e.arbitrators.includes(address))
    .sort((a, b) => calcScore(b) - calcScore(a));

  // ── All disputed escrows — sorted by competition-adjusted score ────────────
  const allDisputed = [...disputedEscrows].sort((a, b) => calcScore(b) - calcScore(a));

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

  const handleResolveDispute = async (escrow) => {
    // ── SECTION 5: Global throttle — only 1 active resolve attempt at a time ─
    if (activeResolve) {
      toast.error('You already have an active resolution attempt. Wait for it to complete.');
      return;
    }

    const feePool         = Number(escrow.dispute_fee_pool || 0);
    const pct             = Math.floor(feePool * 500 / 10_000);
    const estimatedReward = feePool > 0 ? Math.min(feePool, Math.max(pct, MIN_FLOOR)) : 0;
    const hasReward       = estimatedReward > 0;
    const isLowPool       = feePool > 0 && feePool < MIN_FLOOR;
    const estimatedProfit = estimatedReward - GAS_THRESHOLD;
    const belowGas        = hasReward && estimatedReward < GAS_THRESHOLD;
    const compLevel       = competitionLevel(estimatedReward);
    const compMeta        = competitionMeta[compLevel];

    // ── SECTION 1: Pre-flight state check ─────────────────────────────────
    try {
      const live = await contractGetEscrow(escrow.escrow_id);
      if (!live || live.status !== 'Disputed') {
        toast.error('This dispute has already been finalized.');
        await refresh();
        return;
      }
    } catch (_) { /* proceed — contract will reject if already resolved */ }

    // ── SECTION 1: Get caller balance for minimum balance check ───────────
    // Fetch from wallet store or contract
    const callerBalance = useWalletStore.getState().balance ?? 0;
    
    // PHASE 10: Get stake amount for priority weighting
    const stakeAmount = myStake ?? 0;
    
    // PHASE 10 HARDENING — SECTION 1: Get escrow arbitrators for real authority check
    const escrowArbitrators = escrow.arbitrators || [];

    // ── Signal resolution intent (advisory — does not block anyone) ────────
    // Fires after pre-flight passes. Other users will see this on their next
    // refresh and be warned before they attempt execution.
    // Pass isRegistered so backend can label this as "Arbiter attempting resolution".
    // SECTION 3: Pass reward for dynamic priority window calculation
    // PHASE 10: Pass stake amount for priority weighting
    // PHASE 10 HARDENING: Pass escrow arbitrators for real arbiter check
    const intentResult = await signalResolutionIntent(
      address, 
      escrow.escrow_id, 
      isRegistered,
      estimatedReward,    // SECTION 3: for dynamic priority window
      callerBalance,      // SECTION 1: for balance check
      stakeAmount,        // PHASE 10: for stake weighting
      escrowArbitrators   // PHASE 10 HARDENING: for real arbiter check
    ).catch(() => null);

    // PHASE 9: Handle restriction error
    if (intentResult?.error === 'Account restricted due to repeated failures') {
      toast.error(`⛔ Account restricted: ${intentResult.failure_score} failures. Wait ${intentResult.restriction_duration_secs}s before attempting again.`);
      return;
    }
    
    // PHASE 10 FIX — SECTION 5: Handle bond blocking
    if (intentResult?.error === 'Intent blocked due to excessive bond losses') {
      toast.error(`⛔ Intent blocked: ${intentResult.bond_lost} abandoned intents. Wait ${intentResult.block_duration_secs}s.`);
      return;
    }

    // PHASE 9: Handle rate limit error
    if (intentResult?.error === 'Rate limit exceeded') {
      toast.error(`⚠ Rate limit: Max ${intentResult.max_intents_per_minute} intents/minute. Slow down.`);
      return;
    }

    // PHASE 8: Handle cooldown error
    if (intentResult?.error === 'Intent cooldown active') {
      const retrySeconds = Math.ceil((intentResult.retry_after_ms ?? 5000) / 1000);
      const escalationMsg = intentResult.escalation_reason === 'repeated failures' 
        ? ` (escalated due to failures)` 
        : '';
      toast.error(`Intent cooldown: ${retrySeconds}s${escalationMsg}`);
      return;
    }

    // SECTION 1: Check for insufficient balance
    if (intentResult?.insufficient_balance) {
      toast.error(`Insufficient balance to signal intent. Minimum: ${fmtXlm(intentResult.required_balance ?? 1_000_000)} XLM`);
      return;
    }

    // PHASE 8: Show reliability warnings
    if (intentResult?.low_reliability) {
      toast.error('⚠ Your reliability score is LOW. Consider improving your execution rate.');
    }

    // PHASE 9: Show failure score warning
    if (intentResult?.failure_score >= 5) {
      toast.error(`⚠ Failure score: ${intentResult.failure_score}. Cooldown escalated to ${intentResult.escalated_cooldown}s.`);
    }

    // PHASE 9: Show decay penalty warning
    if (intentResult?.decay_penalty < 0) {
      toast.error(`⚠ Intent decay penalty: ${intentResult.decay_penalty} (high abandon rate)`);
    }

    // PHASE 10 FIX — SECTION 5: Show bond warnings at different thresholds
    if (intentResult?.bond_lost >= 6) {
      toast.error(`⛔ Critical: ${intentResult.bond_lost} abandoned intents. Priority penalty: -4.`);
    } else if (intentResult?.bond_lost >= 3) {
      toast.error(`⚠ Warning: ${intentResult.bond_lost} abandoned intents. Priority penalty: -2.`);
    }

    // PHASE 10 FIX — SECTION 3: Show non-staked penalty
    if (intentResult?.stake_weight === 0 && !isRegistered) {
      toast.error(`⚠ No stake: Priority penalty -4. Consider staking to improve priority.`);
    }

    // PHASE 10: Show stake advantage
    if (intentResult?.priority_level === 'HIGH_PRIORITY') {
      toast.success(`✓ High priority resolver (stake: ${intentResult.stake_amount_xlm} XLM)`);
    }

    // Optimistically update local intentMap so UI reflects immediately
    // SECTION 3: Include dynamic priority window
    const priorityWindowSecs = intentResult?.priority_window_secs ?? 8;
    setIntentMap(prev => ({
      ...prev,
      [escrow.escrow_id]: {
        caller:            address,
        is_arbiter:        isRegistered,
        timestamp:         Date.now(),
        unique_callers:    (prev[escrow.escrow_id]?.unique_callers ?? 0) + 1,
        highly_contested:  intentResult?.highly_contested ?? false, // SECTION 4
        expires_in_ms:     12_000,
        in_priority_window: true,
        priority_remaining_ms: priorityWindowSecs * 1000,
        priority_window_secs: priorityWindowSecs, // SECTION 3
        success_chance:    intentResult?.success_chance ?? 'MEDIUM', // SECTION 5
        reliability_score: intentResult?.reliability_score ?? 'UNKNOWN', // PHASE 8
        low_reliability:   intentResult?.low_reliability ?? false, // PHASE 8
      },
    }));

    // If priority window blocked us, warn but don't stop — execution is still permissionless
    if (intentResult?.blocked) {
      const secLeft = Math.ceil((intentResult.priority_remaining_ms ?? 0) / 1000);
      const who = intentResult.is_arbiter ? 'An arbiter' : 'Another participant';
      // PHASE 10 HARDENING — SECTION 1: Show real arbiter override message
      if (intentResult.is_override || intentResult.arbiter_override) {
        toast.success(`✓ Assigned arbiter override: You have absolute priority on this dispute`);
      } else {
        // PHASE 10 HARDENING — SECTION 5: Updated messaging - remove "you can still proceed"
        if (intentResult.reason === 'Higher priority resolver exists') {
          toast.error(`⛔ Lower priority — high risk of losing execution race. ${who} has higher priority (score: ${intentResult.existing_priority_score} vs yours: ${intentResult.your_priority_score}). Margin: ${intentResult.priority_margin_required}.`);
        } else if (intentResult.your_stake_weight !== undefined && intentResult.existing_stake_weight !== undefined) {
          toast.error(`⛔ Lower priority — high risk of losing execution race. ${who} has higher stake (${intentResult.existing_stake_weight} vs yours: ${intentResult.your_stake_weight}).`);
        } else {
          toast.error(`⛔ Lower priority — high risk of losing execution race. ${who} has priority for ~${secLeft}s.`);
        }
      }
    }

    // SECTION 4: Multi-intent signal — auto-disable for 3 seconds if highly contested
    if (intentResult?.highly_contested) {
      toast.error(`⚠ Highly contested — ${intentResult.unique_callers} participants competing. Waiting 3 seconds...`);
      await new Promise(r => setTimeout(r, 3000));
    }
    
    // PHASE 10 HARDENING — SECTION 4: Apply execution delay for low priority
    // Reduces bot advantage without blocking execution
    if (intentResult?.blocked && intentResult.your_priority_score < intentResult.existing_priority_score) {
      const delayMs = 150 + Math.floor(Math.random() * 250); // 150-400ms randomized
      toast.error(`⏱ Low priority delay: ${delayMs}ms`);
      await new Promise(r => setTimeout(r, delayMs));
    }

    // ── Low-reward guard: require "CONFIRM LOSS" typed ─────────────────────
    if (belowGas) {
      const input = window.prompt(
        `⚠ This reward will likely not cover transaction fees.\n\n` +
        `Estimated reward:  ${fmtXlm(estimatedReward)} XLM\n` +
        `Estimated gas:    ~${fmtXlm(GAS_THRESHOLD)} XLM\n` +
        `Estimated profit:  ${fmtXlm(estimatedProfit)} XLM  ← NEGATIVE\n\n` +
        `Type CONFIRM LOSS to proceed anyway:`
      );
      if ((input ?? '').trim() !== 'CONFIRM LOSS') return;
    }

    // ── Build modal message ────────────────────────────────────────────────
    const rewardLine = !hasReward
      ? `Resolver reward: No reward available (empty pool)`
      : isLowPool
        ? `Resolver reward (est.): ${fmtXlm(estimatedReward)} XLM — low pool, may not cover gas`
        : `Resolver reward (est.): ${fmtXlm(estimatedReward)} XLM (not guaranteed)`;

    const competitionWarning = compLevel === 'HIGH'
      ? `⚠ High competition: multiple users likely competing. You may not receive the reward even if you execute.`
      : compLevel === 'MEDIUM'
        ? `⚠ Moderate competition: some users may attempt this simultaneously.`
        : null;

    // SECTION 5: Add success chance hint
    const successChanceHint = intentResult?.success_chance 
      ? `\nEstimated success chance: ${intentResult.success_chance}`
      : '';

    setConfirmModal({
      title: 'Resolve Dispute',
      message: [
        `Escrow #${escrow.escrow_id} — atomically executes all resolution steps:`,
        ``,
        `  1. Transfer funds (release to seller or refund to buyer)`,
        `  2. Slash inactive arbiters`,
        `  3. Slash minority voters`,
        `  4. Distribute rewards to majority voters`,
        ``,
        `⚠ Execution is competitive: You are competing with other participants`,
        `  for this execution. Only the first successful transaction receives`,
        `  the reward. Final outcome depends on being the first successful caller.`,
        ``,
        `Competition level: ${compMeta.label}`,
        ...(competitionWarning ? [competitionWarning] : []),
        successChanceHint, // SECTION 5
        ``,
        `Why resolve this dispute?`,
        `  • May earn a reward from the dispute pool (if available)`,
        `  • Finalize a stuck escrow transaction`,
        `  • Permissionless — anyone can execute`,
        ``,
        rewardLine,
        ``,
        `This is irreversible and can only run once.`,
      ].join('\n'),
      confirmLabel: estimatedProfit < 0
        ? 'Resolve (Likely Loss)'
        : hasReward
          ? `Resolve (${compMeta.label})`
          : 'Resolve Dispute',
      danger: false,
      onConfirm: async () => {
        setProcessingId(escrow.escrow_id);
        setActiveResolve(true);

        // ── SECTION 2: Double-check state inside onConfirm ─────────────────
        try {
          const live = await contractGetEscrow(escrow.escrow_id);
          if (!live || live.status !== 'Disputed') {
            toast.error('This dispute has already been finalized.');
            setProcessingId(null);
            setActiveResolve(false);
            await refresh();
            return;
          }
        } catch (_) { /* proceed */ }

        // ── SECTION 4: Mark escrow as pending locally ──────────────────────
        // ── SECTION 6: Cool-off — disable button for dynamic window ───────
        const cooloffSecs = priorityWindowSecs; // Use dynamic window for cooldown
        setCooldownIds(prev => new Set(prev).add(escrow.escrow_id));
        setTimeout(() => {
          setCooldownIds(prev => { const s = new Set(prev); s.delete(escrow.escrow_id); return s; });
        }, cooloffSecs * 1000);

        // Soft random delay — reduces deterministic bot edge
        const jitter = 50 + Math.floor(Math.random() * 150);
        await new Promise(r => setTimeout(r, jitter));

        try {
          await contractResolveDispute(address, escrow.escrow_id);
          
          // PHASE 8: Track successful execution
          await trackResolutionExecution(address, escrow.escrow_id, true).catch(() => {});

          const summary = await contractGetResolutionSummary(escrow.escrow_id).catch(() => null);
          if (summary) {
            const actualReward = Number(summary.resolver_reward ?? 0);
            const outcome      = String(summary.outcome ?? '');
            const outcomeLabel = outcome === 'release' ? 'Funds released to seller' : 'Refunded to buyer';
            setLastReward({
              escrowId:     escrow.escrow_id,
              amount:       actualReward,
              outcome:      outcomeLabel,
              totalPool:    Number(summary.total_pool    ?? 0),
              totalSlashed: Number(summary.total_slashed ?? 0),
              resolver:     String(summary.resolver ?? address),
            });
            toast.txSuccess(`Dispute resolved — you earned ${fmtXlm(actualReward)} XLM`, '');
          } else {
            setLastReward({ escrowId: escrow.escrow_id, summaryUnavailable: true });
            toast.success('Resolution complete. Check transaction for reward details.');
          }
          await refresh();
        } catch (err) {
          // PHASE 8: Track failed execution
          await trackResolutionExecution(address, escrow.escrow_id, false).catch(() => {});
          
          const msg = err.message ?? '';
          if (msg.includes('already resolved') || msg.includes('EscrowResolved')) {
            toast.error('This dispute has already been finalized.');
          } else if (msg.includes('not in Disputed')) {
            toast.error('Another participant finalized this dispute before your transaction was confirmed. This can happen during high competition.');
          } else {
            toast.error(msg);
          }
        }
        setProcessingId(null);
        setActiveResolve(false);
      },
    });
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
            {/* PHASE 8 & 9: Full reliability display with badge and restrictions */}
            {myUserStats && myUserStats.total_intents > 0 && (
              <div style={{ marginTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.2rem', alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ 
                    fontSize: '0.65rem', 
                    fontWeight: 700,
                    padding: '0.15rem 0.5rem',
                    borderRadius: '999px',
                    background: myUserStats.reliability_score === 'HIGH' ? 'rgba(34,197,94,0.15)' : 
                                myUserStats.reliability_score === 'MEDIUM' ? 'rgba(245,158,11,0.15)' :
                                myUserStats.reliability_score === 'LOW' ? 'rgba(239,68,68,0.15)' : 'rgba(113,113,122,0.15)',
                    color: myUserStats.reliability_score === 'HIGH' ? '#4ade80' : 
                           myUserStats.reliability_score === 'MEDIUM' ? '#f59e0b' :
                           myUserStats.reliability_score === 'LOW' ? '#f87171' : '#71717a',
                  }}>
                    {myUserStats.reliability_score}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: '#71717a' }}>
                    {myUserStats.successful_resolutions}/{myUserStats.total_intents} ({Math.round(myUserStats.success_rate * 100)}%)
                  </span>
                </div>
                {/* PHASE 9: Restriction warning */}
                {myUserStats.restricted && (
                  <span style={{ fontSize: '0.65rem', color: '#f87171', fontWeight: 700 }}>
                    ⛔ RESTRICTED ({myUserStats.restriction_duration}s)
                  </span>
                )}
                {/* PHASE 9: Failure score display */}
                {myUserStats.failure_score >= 5 && !myUserStats.restricted && (
                  <span style={{ fontSize: '0.65rem', color: '#f59e0b' }}>
                    ⚠ Failures: {myUserStats.failure_score} (cooldown: {myUserStats.escalated_cooldown}s)
                  </span>
                )}
                {myUserStats.low_reliability && !myUserStats.restricted && (
                  <span style={{ fontSize: '0.65rem', color: '#f87171' }}>⚠ Low reliability</span>
                )}
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

      {/* ── Last reward banner ── */}
      {lastReward && (
        <div style={{ background: lastReward.summaryUnavailable ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.08)', border: lastReward.summaryUnavailable ? '1px solid rgba(245,158,11,0.25)' : '1px solid rgba(34,197,94,0.25)', borderRadius: '10px', padding: '0.875rem 1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem' }}>
                <CheckCircle2 size={15} color={lastReward.summaryUnavailable ? '#f59e0b' : '#4ade80'} />
                <span style={{ fontSize: '0.875rem', color: lastReward.summaryUnavailable ? '#f59e0b' : '#4ade80', fontWeight: 700 }}>
                  Escrow #{lastReward.escrowId} Resolved
                </span>
              </div>
              {lastReward.summaryUnavailable ? (
                <div style={{ fontSize: '0.78rem', color: '#f59e0b', lineHeight: 1.6 }}>
                  Resolution complete. Reward data unavailable — check transaction details on-chain.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {/* Actual reward — highlighted prominently */}
                  <div style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '8px', padding: '0.6rem 0.875rem', display: 'inline-flex', alignItems: 'baseline', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.68rem', color: '#4ade80', textTransform: 'uppercase', fontWeight: 700 }}>Reward Earned</span>
                    <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#4ade80' }}>{fmtXlm(lastReward.amount)} XLM</span>
                  </div>
                  {/* Resolution details grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.35rem 1.5rem', fontSize: '0.75rem', color: '#71717a', marginTop: '0.25rem' }}>
                    <div><span style={{ color: '#a1a1aa', fontWeight: 600 }}>Outcome: </span>{lastReward.outcome}</div>
                    <div><span style={{ color: '#a1a1aa', fontWeight: 600 }}>Total Pool: </span>{fmtXlm(lastReward.totalPool)} XLM</div>
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem' }}>
                      <span style={{ color: '#a1a1aa', fontWeight: 600, fontFamily: 'inherit' }}>Resolved by: </span>
                      {fmtAddr(lastReward.resolver)}
                    </div>
                    <div><span style={{ color: '#a1a1aa', fontWeight: 600 }}>Total Slashed: </span>{fmtXlm(lastReward.totalSlashed)} XLM</div>
                  </div>
                </div>
              )}
            </div>
            <button onClick={() => setLastReward(null)} style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', borderBottom: '1px solid #27272A' }}>
        {[
          ['queue',    'My Vote Queue',    myQueue.length],
          ['all',      'All Disputes',     allDisputed.length],
          ['register', 'Register / Stake', null],
          ['arbiters', 'Arbiter Registry', allArbiters.length],
          ['system',   'System Health',    null],
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
              {myQueue.map((e) => <DisputeCard key={e.escrow_id} e={e} address={address} processingId={processingId} cooldownIds={cooldownIds} intentMap={intentMap} onVote={handleVote} onResolveDispute={handleResolveDispute} hasMajority={hasMajority} deadlinePassed={deadlinePassed} />)}            </div>
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
              {allDisputed.map((e) => <DisputeCard key={e.escrow_id} e={e} address={address} processingId={processingId} cooldownIds={cooldownIds} intentMap={intentMap} onVote={handleVote} onResolveDispute={handleResolveDispute} hasMajority={hasMajority} deadlinePassed={deadlinePassed} />)}
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
                ['03', 'Majority executes', 'Once majority is reached, anyone calls resolve_dispute. The contract executes the decision atomically — no override possible.'],
                ['04', 'Earn rewards', 'Majority voters split the dispute fee pool (after resolver cut). Minority voters lose 20% stake. Note: minority ≠ dishonest — this is a coordination mechanism, not a truth guarantee.'],
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

            {/* Mode A / Mode B explanation */}
            <div style={{ marginTop: '1.75rem', borderTop: '1px solid #27272A', paddingTop: '1.25rem' }}>
              <div style={{ fontSize: '0.7rem', color: '#71717a', textTransform: 'uppercase', fontWeight: 700, marginBottom: '1rem' }}>Escrow Modes</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)', borderRadius: '8px', padding: '0.875rem' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#60a5fa', marginBottom: '0.5rem' }}>MODE A — Trust-Minimized</div>
                  <div style={{ fontSize: '0.75rem', color: '#71717a', lineHeight: 1.6 }}>
                    No arbitration. Direct settlement only.<br />
                    Buyer confirms or cancels.<br />
                    Max escrow: 500 XLM.<br />
                    No dispute path available.
                  </div>
                </div>
                <div style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)', borderRadius: '8px', padding: '0.875rem' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#a855f7', marginBottom: '0.5rem' }}>MODE B — Arbitration</div>
                  <div style={{ fontSize: '0.75rem', color: '#71717a', lineHeight: 1.6 }}>
                    Panel assigned at dispute time.<br />
                    Arbiters vote Release or Refund.<br />
                    resolve_dispute executes atomically.<br />
                    Required above 500 XLM.
                  </div>
                </div>
              </div>
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
      {/* ── SYSTEM HEALTH ── */}
      {tab === 'system' && (() => {
        const poolSize    = systemHealth ? Number(systemHealth[0]) : null;
        const eligible    = systemHealth ? Number(systemHealth[1]) : null;
        const dispCount   = systemHealth ? Number(systemHealth[2]) : null;
        const isPaused    = systemHealth ? Boolean(systemHealth[3]) : null;
        const spikeCount  = spikeStatus  ? Number(spikeStatus[0])  : null;
        const SPIKE_LIMIT = 50;
        const spikeRatio  = spikeCount !== null ? spikeCount / SPIKE_LIMIT : 0;
        const spikeWarn   = spikeRatio >= 0.7;

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {loading && <div style={{ color: '#71717a', fontSize: '0.85rem' }}>Syncing from chain...</div>}

            {/* Paused banner */}
            {isPaused && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px', padding: '0.875rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <AlertTriangle size={16} color="#f87171" />
                <span style={{ fontSize: '0.875rem', color: '#f87171', fontWeight: 600 }}>Contract is paused — no new escrows or disputes can be created</span>
              </div>
            )}

            {/* Health grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
              {[
                { label: 'Pool Size',         value: poolSize  ?? '—', color: '#60a5fa', icon: Users },
                { label: 'Eligible Arbiters', value: eligible  ?? '—', color: '#4ade80', icon: ShieldCheck },
                { label: 'Active Disputes',   value: dispCount ?? '—', color: '#f87171', icon: Gavel },
                { label: 'System Status',     value: isPaused === null ? '—' : isPaused ? 'PAUSED' : 'ACTIVE', color: isPaused ? '#f87171' : '#4ade80', icon: Activity },
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

            {/* Spike monitor */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
                <Activity size={15} color={spikeWarn ? '#f59e0b' : '#71717a'} />
                <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Dispute Spike Monitor</span>
                {spikeWarn && (
                  <span style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', borderRadius: '999px', padding: '0.1rem 0.5rem', fontSize: '0.65rem', fontWeight: 700 }}>WARNING</span>
                )}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#71717a', marginBottom: '1rem', lineHeight: 1.6 }}>
                Contract auto-pauses if {SPIKE_LIMIT} disputes occur within 1 hour. Current window: {spikeCount ?? '—'} / {SPIKE_LIMIT}.
              </div>
              {/* Progress bar */}
              <div style={{ height: '8px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(spikeRatio * 100, 100)}%`,
                  background: spikeRatio >= 0.9 ? '#ef4444' : spikeRatio >= 0.7 ? '#f59e0b' : '#4ade80',
                  transition: 'width 0.4s',
                  borderRadius: '999px',
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem' }}>
                <span style={{ fontSize: '0.68rem', color: '#71717a' }}>0</span>
                <span style={{ fontSize: '0.68rem', color: spikeWarn ? '#f59e0b' : '#71717a' }}>{spikeCount ?? 0} disputes this hour</span>
                <span style={{ fontSize: '0.68rem', color: '#71717a' }}>{SPIKE_LIMIT} (limit)</span>
              </div>
            </div>

            {/* Execution model explanation */}
            <div className="card">
              <div style={{ fontSize: '0.7rem', color: '#71717a', textTransform: 'uppercase', fontWeight: 700, marginBottom: '1rem' }}>Execution Model</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)', borderRadius: '8px', padding: '0.875rem' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#60a5fa', marginBottom: '0.5rem' }}>MODE A — Trust-Minimized</div>
                  <div style={{ fontSize: '0.75rem', color: '#71717a', lineHeight: 1.7 }}>
                    No arbitration. Direct settlement only.<br />
                    Buyer confirms or cancels before deadline.<br />
                    Max escrow: 500 XLM.<br />
                    No dispute path available.
                  </div>
                </div>
                <div style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)', borderRadius: '8px', padding: '0.875rem' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#a855f7', marginBottom: '0.5rem' }}>MODE B — Arbitration</div>
                  <div style={{ fontSize: '0.75rem', color: '#71717a', lineHeight: 1.7 }}>
                    Panel assigned at dispute time.<br />
                    Arbiters vote Release or Refund.<br />
                    resolve_dispute executes atomically.<br />
                    Anyone can call — earns resolver reward.<br />
                    Required above 500 XLM.
                  </div>
                </div>
              </div>
              <div style={{ marginTop: '1rem', background: 'rgba(201,168,87,0.06)', border: '1px solid rgba(201,168,87,0.15)', borderRadius: '8px', padding: '0.875rem' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#C9A857', marginBottom: '0.4rem' }}>Resolver Incentive</div>
                <div style={{ fontSize: '0.75rem', color: '#71717a', lineHeight: 1.6 }}>
                  Anyone can call resolve_dispute and earn a reward: max(5% of fee pool, 0.05 XLM minimum), capped at the pool balance. Reward comes only from the fee/slash pool — no inflation, escrow principal is never touched.
                </div>
              </div>
            </div>
          </div>
        );
      })()}

    </motion.div>
  );
}

// ── DisputeCard ───────────────────────────────────────────────────────────────
function DisputeCard({ e, address, processingId, cooldownIds, intentMap, onVote, onResolveDispute, hasMajority, deadlinePassed }) {
  const panelSize = e.arbitrators?.length ?? 1;
  const majority = Math.floor(panelSize / 2) + 1;
  const totalVotes = (e.votes_release ?? 0) + (e.votes_refund ?? 0);
  const isMyEscrow = Array.isArray(e.arbitrators) && e.arbitrators.includes(address);
  const canFinalize = hasMajority(e);
  const canForce = deadlinePassed(e);
  const busy = processingId === e.escrow_id;
  const inCooldown = cooldownIds?.has(e.escrow_id) ?? false;

  // ── Intent state — declared BEFORE softBlocked ────────────────────────────
  const intent            = intentMap?.[e.escrow_id] ?? null;
  const intentActive      = !!(intent && intent.expires_in_ms > 0);
  const intentIsMe        = intentActive && intent.caller === address;
  const intentIsArbiter   = intent?.is_arbiter ?? false;
  const uniqueCallers     = intent?.unique_callers ?? 0;
  const highlyContested   = uniqueCallers >= 3;
  const inPriorityWindow  = intent?.in_priority_window ?? false;
  const reliabilityScore  = intent?.reliability_score ?? 'UNKNOWN'; // PHASE 8
  const lowReliability    = intent?.low_reliability ?? false; // PHASE 8

  // Countdown timer for intent owner — ticks every second
  const [countdown, setCountdown] = useState(
    intentIsMe ? Math.ceil((intent?.expires_in_ms ?? 0) / 1000) : 0
  );
  useEffect(() => {
    if (!intentIsMe) { setCountdown(0); return; }
    setCountdown(Math.ceil((intent?.expires_in_ms ?? 0) / 1000));
    const t = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [intentIsMe, intent?.expires_in_ms]);

  // Soft exclusion: if another user has active intent, disable by default.
  // User can still proceed — it's advisory, not a hard lock.
  const [intentOverride, setIntentOverride] = useState(false);
  const softBlocked = intentActive && !intentIsMe && !intentOverride && !inCooldown;
  const resolveDisabled = busy || inCooldown;

  // Resolver reward estimate — strictly bounded by what the contract can pay
  const MIN_FLOOR     = 500_000;
  const GAS_THRESHOLD = 1_000_000;
  const feePool = Number(e.dispute_fee_pool || 0);
  const pct = Math.floor(feePool * 500 / 10_000);
  const estimatedReward = feePool > 0 ? Math.min(feePool, Math.max(pct, MIN_FLOOR)) : 0;
  const hasReward       = estimatedReward > 0;
  const isLowPool       = feePool > 0 && feePool < MIN_FLOOR;
  const estimatedProfit = estimatedReward - GAS_THRESHOLD;
  const belowGas        = hasReward && estimatedReward < GAS_THRESHOLD;
  // Competition level
  const compLevel = estimatedReward > GAS_THRESHOLD * 2 ? 'HIGH'
                  : estimatedReward > GAS_THRESHOLD      ? 'MEDIUM'
                  : 'LOW';
  const compMeta  = {
    HIGH:   { label: 'High competition',     color: '#f87171', bg: 'rgba(239,68,68,0.1)'  },
    MEDIUM: { label: 'Moderate competition', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
    LOW:    { label: 'Low competition',      color: '#4ade80', bg: 'rgba(34,197,94,0.1)'  },
  }[compLevel];
  const fmtXlm = (s) => (Number(s) / 1e7).toFixed(4);
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

      {/* Intent advisory banner */}
      {(canFinalize || canForce) && intentActive && !intentIsMe && (
        <div style={{
          background: highlyContested ? 'rgba(239,68,68,0.08)' : lowReliability ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
          border: `1px solid ${highlyContested ? 'rgba(239,68,68,0.25)' : lowReliability ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
          borderRadius: '8px', padding: '0.6rem 0.875rem', marginBottom: '0.75rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: lowReliability ? '0.3rem' : 0 }}>
            <AlertTriangle size={13} color={highlyContested || lowReliability ? '#f87171' : '#f59e0b'} />
            <span style={{ fontSize: '0.75rem', color: highlyContested || lowReliability ? '#f87171' : '#f59e0b', lineHeight: 1.5 }}>
              {/* SECTION 4: Highly contested warning */}
              {highlyContested
                ? `⚠ Highly contested — ${uniqueCallers} unique participants have signalled intent`
                : inPriorityWindow
                  ? /* SECTION 2: Show arbiter status */ `${intentIsArbiter ? 'An arbiter' : 'A participant'} has priority for ~${Math.ceil((intent.priority_remaining_ms ?? 0) / 1000)}s — they signalled intent first`
                  : `${intentIsArbiter ? 'An arbiter' : 'Another participant'} is currently attempting resolution (~${Math.ceil((intent.expires_in_ms ?? 0) / 1000)}s remaining)`}
            </span>
            {/* PHASE 8: Reliability badge */}
            {reliabilityScore !== 'UNKNOWN' && (
              <span style={{ 
                fontSize: '0.65rem', 
                fontWeight: 700,
                padding: '0.1rem 0.4rem',
                borderRadius: '999px',
                background: reliabilityScore === 'HIGH' ? 'rgba(34,197,94,0.15)' : 
                            reliabilityScore === 'MEDIUM' ? 'rgba(245,158,11,0.15)' :
                            'rgba(239,68,68,0.15)',
                color: reliabilityScore === 'HIGH' ? '#4ade80' : 
                       reliabilityScore === 'MEDIUM' ? '#f59e0b' : '#f87171',
              }}>
                {reliabilityScore}
              </span>
            )}
          </div>
          {/* PHASE 8 — SECTION 6: Low reliability warning */}
          {lowReliability && (
            <div style={{ fontSize: '0.7rem', color: '#f87171', marginLeft: '1.3rem' }}>
              ⚠ Low reliability resolver — high chance of failed execution
            </div>
          )}
        </div>
      )}
      {(canFinalize || canForce) && intentIsMe && (
        <div style={{
          background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)',
          borderRadius: '8px', padding: '0.6rem 0.875rem', marginBottom: '0.75rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CheckCircle2 size={13} color="#4ade80" />
            <span style={{ fontSize: '0.75rem', color: '#4ade80' }}>
              You are currently resolving this dispute
              {/* SECTION 5: Success chance hint */}
              {intent?.success_chance && ` — Success chance: ${intent.success_chance}`}
            </span>
            {/* PHASE 8: Your reliability badge */}
            {reliabilityScore !== 'UNKNOWN' && (
              <span style={{ 
                fontSize: '0.65rem', 
                fontWeight: 700,
                padding: '0.1rem 0.4rem',
                borderRadius: '999px',
                background: reliabilityScore === 'HIGH' ? 'rgba(34,197,94,0.15)' : 
                            reliabilityScore === 'MEDIUM' ? 'rgba(245,158,11,0.15)' :
                            'rgba(239,68,68,0.15)',
                color: reliabilityScore === 'HIGH' ? '#4ade80' : 
                       reliabilityScore === 'MEDIUM' ? '#f59e0b' : '#f87171',
              }}>
                {reliabilityScore}
              </span>
            )}
          </div>
          {countdown > 0 && (
            <span style={{ fontSize: '0.72rem', color: '#4ade80', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
              {countdown}s
            </span>
          )}
        </div>
      )}

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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1 }}>
            {/* Competition level badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.1rem' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: compMeta.color, background: compMeta.bg, borderRadius: '999px', padding: '0.1rem 0.5rem' }}>
                {compMeta.label}
              </span>
              {compLevel === 'HIGH' && (
                <span style={{ fontSize: '0.65rem', color: '#f87171' }}>
                  You may not receive the reward even if you execute
                </span>
              )}
            </div>
            {softBlocked ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <button className="action-btn" disabled style={{ opacity: 0.4, cursor: 'not-allowed', background: 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.3)', color: '#a855f7', fontWeight: 600 }}>
                  ⚡ Resolve Dispute
                </button>
                <span style={{ fontSize: '0.68rem', color: '#f59e0b' }}>
                  {inPriorityWindow
                    ? `${intentIsArbiter ? 'An arbiter' : 'Another participant'} has priority (~${Math.ceil((intent?.priority_remaining_ms ?? 0) / 1000)}s).`
                    : 'Another participant is attempting this.'}{' '}
                  <button onClick={() => setIntentOverride(true)} style={{ background: 'none', border: 'none', color: '#C9A857', cursor: 'pointer', fontSize: '0.68rem', textDecoration: 'underline', padding: 0 }}>
                    Proceed anyway (high competition risk)
                  </button>
                </span>
              </div>
            ) : (
              <button className="action-btn" disabled={resolveDisabled}
                style={{ background: 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.3)', color: '#a855f7', fontWeight: 600, opacity: inCooldown ? 0.5 : 1 }}
                onClick={() => onResolveDispute(e)}
                title="First successful caller receives the reward">
                {busy ? '...' : inCooldown ? '⏳ Cooling down...' : estimatedProfit < 0 ? '⚡ Resolve (Likely Loss)' : `⚡ Resolve (${compMeta.label})`}
              </button>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', paddingLeft: '0.25rem' }}>
              <span style={{ fontSize: '0.67rem', color: '#71717a' }}>⚠ Reward is not guaranteed</span>
              <span style={{ fontSize: '0.67rem', color: '#71717a' }}>⚠ First successful caller receives reward</span>
              {hasReward ? (
                <>
                  <span style={{ fontSize: '0.67rem', color: '#52525b' }}>
                    {isLowPool
                      ? `Est. reward: ${fmtXlm(estimatedReward)} XLM — low pool, may not cover gas`
                      : `Est. reward: ${fmtXlm(estimatedReward)} XLM (not guaranteed)`}
                  </span>
                  <span style={{ fontSize: '0.67rem', color: estimatedProfit < 0 ? '#f87171' : '#52525b' }}>
                    Est. profit after fees (approximate): {fmtXlm(estimatedProfit)} XLM
                    {estimatedProfit < 0 && <span style={{ color: '#f87171', fontWeight: 700, marginLeft: '0.3rem' }}>Negative return</span>}
                  </span>
                </>
              ) : (
                <span style={{ fontSize: '0.67rem', color: '#52525b' }}>No resolver reward available (empty pool)</span>
              )}
            </div>
          </div>
        )}
        {canForce && !canFinalize && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1 }}>
            {/* Competition level badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.1rem' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: compMeta.color, background: compMeta.bg, borderRadius: '999px', padding: '0.1rem 0.5rem' }}>
                {compMeta.label}
              </span>
              {compLevel === 'HIGH' && (
                <span style={{ fontSize: '0.65rem', color: '#f87171' }}>
                  You may not receive the reward even if you execute
                </span>
              )}
            </div>
            {softBlocked ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <button className="action-btn" disabled style={{ opacity: 0.4, cursor: 'not-allowed', background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)', color: '#f87171', fontWeight: 600 }}>
                  ⏱ Resolve Dispute (Deadline Passed)
                </button>
                <span style={{ fontSize: '0.68rem', color: '#f59e0b' }}>
                  {inPriorityWindow
                    ? `${intentIsArbiter ? 'An arbiter' : 'Another participant'} has priority (~${Math.ceil((intent?.priority_remaining_ms ?? 0) / 1000)}s).`
                    : 'Another participant is attempting this.'}{' '}
                  <button onClick={() => setIntentOverride(true)} style={{ background: 'none', border: 'none', color: '#C9A857', cursor: 'pointer', fontSize: '0.68rem', textDecoration: 'underline', padding: 0 }}>
                    Proceed anyway (high competition risk)
                  </button>
                </span>
              </div>
            ) : (
              <button className="action-btn" disabled={resolveDisabled}
                style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)', color: '#f87171', fontWeight: 600, opacity: inCooldown ? 0.5 : 1 }}
                onClick={() => onResolveDispute(e)}
                title="First successful caller receives the reward">
                {busy ? '...' : inCooldown ? '⏳ Cooling down...' : estimatedProfit < 0 ? '⏱ Resolve (Likely Loss)' : `⏱ Resolve (${compMeta.label})`}
              </button>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', paddingLeft: '0.25rem' }}>
              <span style={{ fontSize: '0.67rem', color: '#71717a' }}>⚠ Reward is not guaranteed</span>
              <span style={{ fontSize: '0.67rem', color: '#71717a' }}>⚠ First successful caller receives reward</span>
              {hasReward ? (
                <>
                  <span style={{ fontSize: '0.67rem', color: '#52525b' }}>
                    {isLowPool
                      ? `Est. reward: ${fmtXlm(estimatedReward)} XLM — low pool, may not cover gas`
                      : `Est. reward: ${fmtXlm(estimatedReward)} XLM (not guaranteed)`}
                  </span>
                  <span style={{ fontSize: '0.67rem', color: estimatedProfit < 0 ? '#f87171' : '#52525b' }}>
                    Est. profit after fees (approximate): {fmtXlm(estimatedProfit)} XLM
                    {estimatedProfit < 0 && <span style={{ color: '#f87171', fontWeight: 700, marginLeft: '0.3rem' }}>Negative return</span>}
                  </span>
                </>
              ) : (
                <span style={{ fontSize: '0.67rem', color: '#52525b' }}>No resolver reward available (empty pool)</span>
              )}
            </div>
          </div>
        )}
        {/* Already finalized guard — shown when escrow left Disputed state externally */}
        {!canFinalize && !canForce && e.status !== 'Disputed' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button className="action-btn" disabled style={{ opacity: 0.4, cursor: 'not-allowed' }}>
              ⚡ Resolve Dispute
            </button>
            <span style={{ fontSize: '0.75rem', color: '#71717a', fontStyle: 'italic' }}>
              This dispute has already been finalized.
            </span>
          </div>
        )}
        {!isMyEscrow && !canFinalize && !canForce && (
          <span style={{ fontSize: '0.78rem', color: '#71717a', fontStyle: 'italic' }}>You are not on this arbitration panel</span>
        )}
      </div>
    </div>
  );
}

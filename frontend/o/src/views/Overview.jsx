/**
 * Overview — Premium fintech-style DeFi dashboard.
 * Portfolio tab: hero summary, action center, position details, advanced metrics.
 * Network tab: clean protocol stats without visual clutter.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWalletStore } from '../store/wallet';
import { useLendingStore, calcRepayAmount } from '../store/lending';
import { useAnalytics } from '../store/analytics';
import { useNetworkStats } from '../store/networkStats';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, TrendingDown, Shield, Landmark, Coins,
  AlertTriangle, Users, Activity, Globe, ArrowRight,
  CheckCircle2, ChevronDown, ChevronUp, Wallet,
} from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n, d = 2) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(d)}M`
  : n >= 1_000   ? `${(n / 1_000).toFixed(d)}K`
  : parseFloat(n || 0).toFixed(d);

// ── Hero Stat Card ─────────────────────────────────────────────────────────────
function HeroCard({ label, value, unit, status, statusColor, onClick }) {
  return (
    <motion.div
      onClick={onClick}
      whileHover={onClick ? { y: -2 } : {}}
      style={{
        background: '#1a1a1d',
        border: '1px solid #2a2a2e',
        borderRadius: '16px',
        padding: '1.75rem',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.2s',
        flex: 1,
        minWidth: 0,
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.borderColor = '#3a3a3e'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a2e'; }}
    >
      <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: '0.75rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '2rem', fontWeight: 700, color: '#f5f5f5', lineHeight: 1, marginBottom: '0.5rem' }}>
        {value}
        {unit && <span style={{ fontSize: '1rem', color: '#6b7280', marginLeft: '0.4rem', fontWeight: 500 }}>{unit}</span>}
      </div>
      {status && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.4rem' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor || '#10b981', flexShrink: 0 }} />
          <span style={{ fontSize: '0.78rem', color: statusColor || '#10b981', fontWeight: 500 }}>{status}</span>
        </div>
      )}
    </motion.div>
  );
}

// ── Action Button ──────────────────────────────────────────────────────────────
function ActionBtn({ label, icon: Icon, color, onClick }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
        padding: '1rem 0.75rem',
        background: '#1a1a1d',
        border: '1px solid #2a2a2e',
        borderRadius: '12px',
        cursor: 'pointer',
        flex: 1,
        minWidth: 0,
        transition: 'border-color 0.2s, background 0.2s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.background = `${color}0d`; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a2e'; e.currentTarget.style.background = '#1a1a1d'; }}
    >
      <div style={{ width: 36, height: 36, borderRadius: '10px', background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={16} color={color} />
      </div>
      <span style={{ fontSize: '0.72rem', color: '#a1a1aa', fontWeight: 600, textAlign: 'center', lineHeight: 1.3 }}>{label}</span>
    </motion.button>
  );
}

// ── Small Metric Row ───────────────────────────────────────────────────────────
function MetricRow({ label, value, sub, color = '#a1a1aa' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 0', borderBottom: '1px solid #1f1f22' }}>
      <div>
        <div style={{ fontSize: '0.85rem', color: '#d4d4d8', fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '0.15rem' }}>{sub}</div>}
      </div>
      <div style={{ fontSize: '0.95rem', fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

// ── Portfolio Tab ──────────────────────────────────────────────────────────────
function MyPortfolio() {
  const { address, balance } = useWalletStore();
  const { loans, deposits, fixedDeposits, creditScore, fetchPoolBalance } = useLendingStore();
  const navigate = useNavigate();
  const [onChainCollateral, setOnChainCollateral] = useState(null);
  const [onChainHealth, setOnChainHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    fetchPoolBalance();
    if (!address) return;
    const load = async () => {
      setLoading(true);
      try {
        const { getCollateral, getHealthFactor } = await import('../store/pool_contract.js');
        const [col, health] = await Promise.all([getCollateral(address), getHealthFactor(address)]);
        setOnChainCollateral(col !== null ? Number(col) / 1e7 : 0);
        setOnChainHealth(health !== null ? Number(health) / 10000 : null);
      } catch (_) {}
      setLoading(false);
    };
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [address, fetchPoolBalance]);

  const totalSupplied   = deposits.reduce((a, d) => a + d.amount, 0);
  const activeLoans     = loans.filter(l => l.status === 'Active' || l.status === 'Partial');
  const totalBorrowed   = activeLoans.reduce((a, l) => {
    const dl = Math.max(0, Math.ceil((Date.now() - new Date(l.dueDate)) / 86400000));
    return a + calcRepayAmount(l.amount, l.apy, l.term, dl) - l.amountRepaid;
  }, 0);
  const activeFDs       = fixedDeposits.filter(f => f.status === 'Active');
  const totalFDLocked   = activeFDs.reduce((a, f) => a + f.amount, 0);
  const maturedFDs      = activeFDs.filter(f => new Date(f.maturesAt) <= new Date());
  const netPosition     = totalSupplied + totalFDLocked - totalBorrowed;
  const collateral      = onChainCollateral || 0;
  const hf              = onChainHealth;

  // Risk banner config
  const riskBanner = hf !== null && hf > 0
    ? hf >= 1.5
      ? { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.2)', color: '#10b981', icon: <CheckCircle2 size={16} />, text: 'Safe Position — Your collateral comfortably covers your debt.' }
      : hf >= 1.1
      ? { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)', color: '#f59e0b', icon: <AlertTriangle size={16} />, text: 'Caution — Health factor is low. Consider adding collateral.' }
      : { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)', color: '#ef4444', icon: <AlertTriangle size={16} />, text: 'Liquidation Risk — Add collateral or repay loans immediately.' }
    : null;

  const scoreLabel = creditScore >= 720 ? 'Excellent' : creditScore >= 640 ? 'Good' : creditScore >= 540 ? 'Fair' : creditScore >= 400 ? 'Poor' : 'Very Poor';
  const scoreColor = creditScore >= 720 ? '#10b981' : creditScore >= 640 ? '#34d399' : creditScore >= 540 ? '#f59e0b' : creditScore >= 400 ? '#f97316' : '#ef4444';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Matured FD banner */}
      {maturedFDs.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          onClick={() => navigate('/lending')}
          style={{ padding: '0.875rem 1.25rem', borderRadius: '12px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Coins size={16} color="#10b981" />
            <span style={{ fontSize: '0.875rem', color: '#10b981', fontWeight: 600 }}>
              {maturedFDs.length} Fixed Deposit{maturedFDs.length > 1 ? 's' : ''} ready to claim
            </span>
          </div>
          <ArrowRight size={14} color="#10b981" />
        </motion.div>
      )}

      {/* Risk banner */}
      {riskBanner && (
        <motion.div
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          style={{ padding: '0.875rem 1.25rem', borderRadius: '12px', background: riskBanner.bg, border: `1px solid ${riskBanner.border}`, display: 'flex', alignItems: 'center', gap: '0.6rem' }}
        >
          <span style={{ color: riskBanner.color }}>{riskBanner.icon}</span>
          <span style={{ fontSize: '0.875rem', color: riskBanner.color, fontWeight: 500 }}>{riskBanner.text}</span>
        </motion.div>
      )}

      {/* ── SECTION 1: Hero Summary ── */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <HeroCard
          label="Wallet Balance"
          value={parseFloat(balance || 0).toFixed(2)}
          unit="XLM"
          status="Available to use"
          statusColor="#6b7280"
        />
        <HeroCard
          label="Net Position"
          value={`${netPosition >= 0 ? '+' : ''}${fmt(netPosition)}`}
          unit="XLM"
          status={netPosition >= 0 ? 'Net lender' : 'Net borrower'}
          statusColor={netPosition >= 0 ? '#10b981' : '#f59e0b'}
        />
        <HeroCard
          label="Health Factor"
          value={loading ? '—' : hf !== null ? hf.toFixed(2) : '—'}
          status={
            loading ? 'Loading...'
            : hf === null ? 'No active debt'
            : hf >= 1.5 ? 'Safe — well collateralised'
            : hf >= 1.1 ? 'Caution — monitor closely'
            : 'At risk — act now'
          }
          statusColor={
            loading || hf === null ? '#6b7280'
            : hf >= 1.5 ? '#10b981'
            : hf >= 1.1 ? '#f59e0b'
            : '#ef4444'
          }
          onClick={() => navigate('/lending')}
        />
        <HeroCard
          label="Total Borrowed"
          value={fmt(totalBorrowed)}
          unit="XLM"
          status={activeLoans.length > 0 ? `${activeLoans.length} active loan${activeLoans.length > 1 ? 's' : ''}` : 'No active loans'}
          statusColor={totalBorrowed > 0 ? '#f59e0b' : '#6b7280'}
          onClick={totalBorrowed > 0 ? () => navigate('/lending') : undefined}
        />
      </div>

      {/* ── SECTION 2: Action Center ── */}
      <div style={{ background: '#1a1a1d', border: '1px solid #2a2a2e', borderRadius: '16px', padding: '1.5rem' }}>
        <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: '1rem' }}>
          Quick Actions
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <ActionBtn label="Supply Liquidity"  icon={TrendingUp}   color="#10b981" onClick={() => navigate('/lending')} />
          <ActionBtn label="Borrow Funds"      icon={Coins}        color="#6366f1" onClick={() => navigate('/lending')} />
          <ActionBtn label="Repay Loan"        icon={TrendingDown} color="#f59e0b" onClick={() => navigate('/lending')} />
          <ActionBtn label="Add Collateral"    icon={Shield}       color="#8b5cf6" onClick={() => navigate('/lending')} />
          <ActionBtn label="Create Escrow"     icon={Landmark}     color="#a855f7" onClick={() => navigate('/escrow')} />
          <ActionBtn label="Fixed Deposit"     icon={Wallet}       color="#10b981" onClick={() => navigate('/lending')} />
        </div>
      </div>

      {/* ── SECTION 3: Portfolio Details ── */}
      <div style={{ background: '#1a1a1d', border: '1px solid #2a2a2e', borderRadius: '16px', padding: '1.5rem' }}>
        <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: '0.25rem' }}>
          Portfolio Breakdown
        </div>
        <MetricRow label="Supplied to Pool"  value={`${fmt(totalSupplied)} XLM`}  sub={`${deposits.length} position${deposits.length !== 1 ? 's' : ''}`}  color="#10b981" />
        <MetricRow label="Fixed Deposits"    value={`${fmt(totalFDLocked)} XLM`}  sub={`${activeFDs.length} active deposit${activeFDs.length !== 1 ? 's' : ''}`} color="#6366f1" />
        <MetricRow label="Collateral Locked" value={loading ? '—' : `${collateral.toFixed(2)} XLM`} sub="In pool contract" color="#8b5cf6" />
        <MetricRow label="Credit Score"      value={`${creditScore} / 800`}       sub={scoreLabel}  color={scoreColor} />
        <div style={{ paddingTop: '0.875rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => navigate('/lending')} style={{ fontSize: '0.78rem', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            Manage positions <ArrowRight size={12} />
          </button>
        </div>
      </div>

      {/* ── SECTION 4: Active Loans ── */}
      {activeLoans.length > 0 && (
        <div style={{ background: '#1a1a1d', border: '1px solid #2a2a2e', borderRadius: '16px', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
            <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Active Loans</div>
            <button onClick={() => navigate('/lending')} style={{ fontSize: '0.78rem', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              Manage <ArrowRight size={12} />
            </button>
          </div>
          {activeLoans.map((loan, i) => {
            const dl  = Math.max(0, Math.ceil((Date.now() - new Date(loan.dueDate)) / 86400000));
            const rem = calcRepayAmount(loan.amount, loan.apy, loan.term, dl) - loan.amountRepaid;
            return (
              <MetricRow
                key={i}
                label={`${loan.amount} ${loan.asset} loan`}
                sub={dl > 0 ? `${dl}d overdue` : `Due ${new Date(loan.dueDate).toLocaleDateString()}`}
                value={`${rem.toFixed(2)} XLM`}
                color={dl > 0 ? '#ef4444' : '#f5f5f5'}
              />
            );
          })}
        </div>
      )}

      {/* ── SECTION 5: Advanced Metrics (collapsible) ── */}
      <div style={{ background: '#1a1a1d', border: '1px solid #2a2a2e', borderRadius: '16px', overflow: 'hidden' }}>
        <button
          onClick={() => setShowAdvanced(v => !v)}
          style={{ width: '100%', padding: '1rem 1.5rem', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <span style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Advanced Metrics</span>
          {showAdvanced ? <ChevronUp size={14} color="#6b7280" /> : <ChevronDown size={14} color="#6b7280" />}
        </button>
        {showAdvanced && (
          <div style={{ padding: '0 1.5rem 1.5rem' }}>
            <MetricRow label="Net DeFi Position" value={`${netPosition >= 0 ? '+' : ''}${fmt(netPosition)} XLM`} sub={`${fmt(totalSupplied)} supplied + ${fmt(totalFDLocked)} FD − ${fmt(totalBorrowed)} debt`} color={netPosition >= 0 ? '#10b981' : '#ef4444'} />
            <MetricRow label="Health Factor"     value={hf !== null ? hf.toFixed(4) : '—'} sub="Collateral / debt ratio. Stay above 1.0." color={hf === null ? '#6b7280' : hf >= 1.5 ? '#10b981' : hf >= 1.1 ? '#f59e0b' : '#ef4444'} />
            <MetricRow label="Credit Score"      value={`${creditScore} / 800`} sub={scoreLabel} color={scoreColor} />
          </div>
        )}
      </div>

    </div>
  );
}

// ── Network Stats Tab ──────────────────────────────────────────────────────────
function NetworkStatsTab() {
  const { totalVolume, nodeCount, successCount, failCount, poolBalance, escrowBalance, ledgerSettlementSec, networkStatus, networkColor, fetchBalances, fetchSettlementTime, fetchBackendMetrics, backendAccuracy } = useAnalytics();
  const { settlementTime } = useNetworkStats();
  const { loans, deposits, fixedDeposits } = useLendingStore();
  const { transactions } = useWalletStore();

  useEffect(() => {
    fetchBalances(); fetchSettlementTime(); fetchBackendMetrics();
    const t1 = setInterval(fetchBalances, 30_000);
    const t2 = setInterval(fetchBackendMetrics, 60_000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [fetchBalances, fetchSettlementTime, fetchBackendMetrics]);

  const totalAttempted  = successCount + failCount;
  const accuracy        = backendAccuracy !== null && backendAccuracy !== undefined
    ? backendAccuracy.toFixed(1)
    : totalAttempted > 0 ? ((successCount / totalAttempted) * 100).toFixed(1) : '—';
  const accuracyColor   = parseFloat(accuracy) >= 95 ? '#10b981' : parseFloat(accuracy) >= 80 ? '#f59e0b' : '#ef4444';
  const settleTime      = ledgerSettlementSec || settlementTime;
  const tvl             = poolBalance + escrowBalance;
  const totalBorrowed   = loans.filter(l => l.status === 'Active' || l.status === 'Partial').reduce((a, l) => a + l.amount, 0);
  const totalSupplied   = deposits.reduce((a, d) => a + d.amount, 0);
  const totalFDLocked   = fixedDeposits.filter(f => f.status === 'Active').reduce((a, f) => a + f.amount, 0);
  const escrowTxs       = transactions.filter(t => t.type === 'Create Escrow');
  const activeEscrows   = escrowTxs.filter(t => t.status === 'Funded' || t.status === 'Delivered').length;

  const statRows = [
    { label: 'Total Nodes',       value: nodeCount || '—',                  sub: 'Unique wallets connected',          color: '#a855f7' },
    { label: 'Network Accuracy',  value: `${accuracy}%`,                    sub: accuracyColor === '#10b981' ? 'All transactions confirming normally' : 'Some transactions failing', color: accuracyColor },
    { label: 'Settlement Time',   value: settleTime ? `${settleTime}s` : '—', sub: 'Avg Stellar ledger close time',   color: networkColor || '#10b981' },
    { label: 'Total Volume',      value: totalVolume > 0 ? `${fmt(totalVolume)} XLM` : tvl > 0 ? `${fmt(tvl)} XLM` : '—', sub: 'All confirmed transactions', color: '#6366f1' },
    { label: 'Pool Liquidity',    value: `${fmt(poolBalance)} XLM`,          sub: 'Available to borrow',               color: '#10b981' },
    { label: 'Escrow Locked',     value: `${fmt(escrowBalance)} XLM`,        sub: 'In active contracts',               color: '#a855f7' },
    { label: 'Total Supplied',    value: `${fmt(totalSupplied)} XLM`,        sub: 'Liquidity contributions',           color: '#10b981' },
    { label: 'Total Borrowed',    value: `${fmt(totalBorrowed)} XLM`,        sub: 'Active debt',                       color: '#f59e0b' },
    { label: 'FD Locked',         value: `${fmt(totalFDLocked)} XLM`,        sub: 'Fixed-term deposits',               color: '#6366f1' },
    { label: 'Active Escrows',    value: activeEscrows || '0',               sub: `${escrowTxs.length} total contracts`, color: '#a855f7' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Hero row — 3 key network stats */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <HeroCard label="Network Accuracy"  value={`${accuracy}%`}                    status={accuracyColor === '#10b981' ? 'Healthy' : 'Degraded'} statusColor={accuracyColor} />
        <HeroCard label="Settlement Time"   value={settleTime ? `${settleTime}s` : '—'} status="Avg ledger close" statusColor={networkColor || '#10b981'} />
        <HeroCard label="Active Nodes"      value={nodeCount || '—'}                   status="Unique wallets" statusColor="#6b7280" />
      </div>

      {/* All metrics in a clean list */}
      <div style={{ background: '#1a1a1d', border: '1px solid #2a2a2e', borderRadius: '16px', padding: '1.5rem' }}>
        <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: '0.25rem' }}>
          Protocol Metrics
        </div>
        {statRows.map((r, i) => (
          <MetricRow key={i} label={r.label} value={r.value} sub={r.sub} color={r.color} />
        ))}
      </div>

    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function Overview() {
  const [tab, setTab] = useState('portfolio');

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>

      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: '0.4rem' }}>
          Your Position
        </div>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f5f5f5', margin: 0 }}>Overview</h2>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '2rem', background: '#1a1a1d', border: '1px solid #2a2a2e', borderRadius: '12px', padding: '0.25rem' }}>
        {[['portfolio', 'My Portfolio'], ['network', 'Network Stats']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              flex: 1, padding: '0.6rem 1rem', borderRadius: '9px', border: 'none', cursor: 'pointer',
              fontWeight: 600, fontSize: '0.875rem', transition: 'all 0.15s',
              background: tab === id ? '#2a2a2e' : 'transparent',
              color: tab === id ? '#f5f5f5' : '#6b7280',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
        >
          {tab === 'portfolio' ? <MyPortfolio /> : <NetworkStatsTab />}
        </motion.div>
      </AnimatePresence>

    </motion.div>
  );
}

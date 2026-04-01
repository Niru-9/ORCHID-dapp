import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAnalytics } from '../store/analytics';
import { useLendingStore } from '../store/lending';
import { useWalletStore } from '../store/wallet';
import { Users, TrendingUp, ShieldCheck, Landmark, Coins, Activity } from 'lucide-react';

function StatCard({ icon: Icon, label, value, sub, color = 'var(--accent-glow)' }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: `${color}18`, border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={18} color={color} />
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</div>
      </div>
      <div style={{ fontSize: '2rem', fontWeight: 800, fontFamily: 'Orbitron, sans-serif', color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

function fmt(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(2)}K`;
  return parseFloat(n).toFixed(2);
}

export default function NetworkStats() {
  const { totalVolume, nodeCount, successCount, failCount, poolBalance, escrowBalance, ledgerSettlementSec, networkStatus, networkColor, fetchBalances, fetchSettlementTime, fetchBackendMetrics } = useAnalytics();
  const { loans, deposits, fixedDeposits } = useLendingStore();
  const { transactions } = useWalletStore();

  useEffect(() => {
    fetchBalances(); fetchSettlementTime(); fetchBackendMetrics();
    const t1 = setInterval(fetchBalances, 30_000);
    const t2 = setInterval(fetchBackendMetrics, 15_000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [fetchBalances, fetchSettlementTime, fetchBackendMetrics]);

  const totalAttempted = successCount + failCount;
  const accuracy = totalAttempted > 0 ? ((successCount / totalAttempted) * 100).toFixed(1) : '100.0';
  const totalBorrowed = loans.reduce((acc, l) => acc + l.amount, 0);
  const activeBorrowed = loans.filter(l => l.status === 'Active' || l.status === 'Partial').reduce((acc, l) => acc + (l.amount - l.amountRepaid), 0);
  const totalSupplied = deposits.reduce((acc, d) => acc + d.amount, 0);
  const totalFdLocked = fixedDeposits.filter(f => f.status === 'Active').reduce((acc, f) => acc + f.amount, 0);
  const escrowTxs = transactions.filter(t => t.type === 'Create Escrow');
  const activeEscrows = escrowTxs.filter(t => t.status === 'Funded' || t.status === 'Delivered').length;
  const totalEscrowValue = escrowTxs.filter(t => t.status === 'Funded' || t.status === 'Delivered').reduce((acc, t) => acc + parseFloat(t.amount?.split(' ')[0] || 0), 0);
  const settleTime = ledgerSettlementSec; // analytics only — no networkStats fallback
  const tvl = poolBalance + escrowBalance;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="view-header">
        <div>
          <h2 className="view-title">Network Stats</h2>
          <p className="view-subtitle">Live protocol metrics — users, volume, escrow, lending, and network health.</p>
        </div>
      </div>

      {/* Section: Users */}
      <div style={{ marginBottom: '0.75rem', fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Users</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <StatCard icon={Users} label="Total Nodes" value={nodeCount || '—'} sub="Unique wallets ever connected" color="#a855f7" />
        <StatCard icon={Activity} label="Network Accuracy" value={`${accuracy}%`} sub={`${successCount} success / ${failCount} failed`} color={parseFloat(accuracy) >= 95 ? '#10b981' : '#f59e0b'} />
        <StatCard icon={TrendingUp} label="Settlement Time" value={settleTime ? `${settleTime}s` : '—'} sub={networkStatus} color={networkColor} />
      </div>

      {/* Section: Volume */}
      <div style={{ marginBottom: '0.75rem', fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Volume</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <StatCard icon={Coins} label="Total Network Volume" value={totalVolume > 0 ? `${fmt(totalVolume)} XLM` : '—'} sub="All confirmed transactions" color="#38bdf8" />
        <StatCard icon={Landmark} label="Pool Liquidity (TVL)" value={`${fmt(poolBalance)} XLM`} sub="Live balance of liquidity pool" color="#22c55e" />
        <StatCard icon={ShieldCheck} label="Escrow Locked" value={`${fmt(escrowBalance)} XLM`} sub="Live balance of escrow account" color="#f59e0b" />
      </div>

      {/* Section: Escrow */}
      <div style={{ marginBottom: '0.75rem', fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Escrow</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <StatCard icon={ShieldCheck} label="Total Escrow Contracts" value={escrowTxs.length || '0'} sub="All time" color="#f59e0b" />
        <StatCard icon={ShieldCheck} label="Active Escrows" value={activeEscrows || '0'} sub="Funded or awaiting release" color="#38bdf8" />
        <StatCard icon={Coins} label="Total Escrow Value" value={`${fmt(totalEscrowValue)} XLM`} sub="Currently locked in active escrows" color="#f59e0b" />
      </div>

      {/* Section: Lending */}
      <div style={{ marginBottom: '0.75rem', fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Lending</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <StatCard icon={Landmark} label="Total Supplied" value={`${fmt(totalSupplied)} XLM`} sub="All liquidity contributions" color="#22c55e" />
        <StatCard icon={Landmark} label="Total Borrowed" value={`${fmt(totalBorrowed)} XLM`} sub="All time loan disbursements" color="#ef4444" />
        <StatCard icon={Landmark} label="Active Debt" value={`${fmt(activeBorrowed)} XLM`} sub="Outstanding loan balance" color="#f97316" />
        <StatCard icon={Coins} label="Fixed Deposits Locked" value={`${fmt(totalFdLocked)} XLM`} sub="Active FDs awaiting maturity" color="#a855f7" />
      </div>
    </motion.div>
  );
}

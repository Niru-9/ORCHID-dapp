import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useWalletStore } from '../store/wallet';
import { useLendingStore, calcRepayAmount, calcFdPayout } from '../store/lending';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, Shield, Landmark, Coins, BarChart2, ExternalLink, AlertTriangle } from 'lucide-react';

function StatCard({ label, value, sub, color, icon: Icon, onClick }) {
  return (
    <motion.div
      className="card"
      style={{ cursor: onClick ? 'pointer' : 'default', border: `1px solid ${color}22`, background: `linear-gradient(135deg, var(--bg-surface) 0%, ${color}08 100%)` }}
      whileHover={onClick ? { scale: 1.02 } : {}}
      onClick={onClick}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: `${color}18`, border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={16} color={color} />
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</div>
      </div>
      <div style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'Orbitron, sans-serif', color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>{sub}</div>}
    </motion.div>
  );
}

export default function Portfolio() {
  const { address, balance } = useWalletStore();
  const { loans, deposits, fixedDeposits, creditScore, poolBalance, poolUtilization, fetchPoolBalance } = useLendingStore();
  const navigate = useNavigate();

  const [onChainCollateral, setOnChainCollateral] = useState(null);
  const [onChainHealth, setOnChainHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPoolBalance();
    if (!address) return;
    const fetch = async () => {
      setLoading(true);
      try {
        const { getCollateral, getHealthFactor } = await import('../store/pool_contract.js');
        const [col, health] = await Promise.all([getCollateral(address), getHealthFactor(address)]);
        setOnChainCollateral(col !== null ? Number(col) / 1e7 : 0);
        setOnChainHealth(health !== null ? Number(health) / 10000 : null);
      } catch (_) {}
      setLoading(false);
    };
    fetch();
    const t = setInterval(fetch, 30_000);
    return () => clearInterval(t);
  }, [address, fetchPoolBalance]);

  // Derived metrics
  const totalSupplied = deposits.reduce((acc, d) => acc + d.amount, 0);
  const activeLoans = loans.filter(l => l.status === 'Active' || l.status === 'Partial');
  const totalBorrowed = activeLoans.reduce((acc, l) => {
    const daysLate = Math.max(0, Math.ceil((Date.now() - new Date(l.dueDate)) / 86400000));
    return acc + calcRepayAmount(l.amount, l.apy, l.term, daysLate) - l.amountRepaid;
  }, 0);
  const activeFDs = fixedDeposits.filter(f => f.status === 'Active');
  const totalFDLocked = activeFDs.reduce((acc, f) => acc + f.amount, 0);
  const totalFDPayout = activeFDs.reduce((acc, f) => acc + f.payout, 0);
  const maturedFDs = fixedDeposits.filter(f => f.status === 'Active' && new Date(f.maturesAt) <= new Date());

  const netPosition = totalSupplied + totalFDLocked - totalBorrowed;
  const netColor = netPosition >= 0 ? '#10b981' : '#ef4444';

  const scoreColor = creditScore >= 720 ? '#10b981' : creditScore >= 640 ? '#34d399' : creditScore >= 540 ? '#f59e0b' : creditScore >= 400 ? '#f97316' : '#ef4444';
  const scoreBand = creditScore >= 720 ? 'Excellent' : creditScore >= 640 ? 'Good' : creditScore >= 540 ? 'Fair' : creditScore >= 400 ? 'Poor' : 'Very Poor';

  const healthColor = onChainHealth === null ? 'var(--text-muted)' : onChainHealth >= 1.5 ? '#10b981' : onChainHealth >= 1.1 ? '#f59e0b' : '#ef4444';
  const healthLabel = onChainHealth === null ? '—' : onChainHealth >= 1.5 ? 'Safe' : onChainHealth >= 1.1 ? 'Caution' : 'At Risk';

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="view-header">
        <div>
          <h2 className="view-title">Portfolio</h2>
          <p className="view-subtitle">Your complete DeFi position across all Orchid protocols.</p>
        </div>
        {address && (
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.5rem 0.75rem', background: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
            {address.slice(0, 8)}...{address.slice(-6)}
          </div>
        )}
      </div>

      {/* Matured FD alert */}
      {maturedFDs.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ padding: '0.875rem 1rem', marginBottom: '1.5rem', borderRadius: '10px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}
          onClick={() => navigate('/lending')}>
          <Coins size={18} color="#22c55e" />
          <span style={{ fontSize: '0.875rem', color: '#22c55e', fontWeight: 600 }}>
            {maturedFDs.length} Fixed Deposit{maturedFDs.length > 1 ? 's' : ''} matured — claim your payout now →
          </span>
        </motion.div>
      )}

      {/* Health factor warning */}
      {onChainHealth !== null && onChainHealth < 1.2 && onChainHealth > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ padding: '0.875rem 1rem', marginBottom: '1.5rem', borderRadius: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <AlertTriangle size={18} color="#ef4444" />
          <span style={{ fontSize: '0.875rem', color: '#ef4444', fontWeight: 600 }}>
            Health factor {onChainHealth.toFixed(2)} — position at risk of liquidation. Add collateral or repay loans.
          </span>
        </motion.div>
      )}

      {/* Overview cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <StatCard label="Wallet Balance" value={`${parseFloat(balance || 0).toFixed(2)} XLM`} sub="Available to use" color="#38bdf8" icon={Coins} />
        <StatCard label="Total Supplied" value={`${totalSupplied.toFixed(2)} XLM`} sub={`${deposits.length} position${deposits.length !== 1 ? 's' : ''}`} color="#10b981" icon={TrendingUp} onClick={() => navigate('/lending')} />
        <StatCard label="Total Borrowed" value={`${totalBorrowed.toFixed(2)} XLM`} sub={`${activeLoans.length} active loan${activeLoans.length !== 1 ? 's' : ''}`} color={totalBorrowed > 0 ? '#ef4444' : 'var(--text-muted)'} icon={TrendingDown} onClick={() => navigate('/lending')} />
        <StatCard label="FD Locked" value={`${totalFDLocked.toFixed(2)} XLM`} sub={`Payout: ${totalFDPayout.toFixed(2)} XLM`} color="#a855f7" icon={Landmark} onClick={() => navigate('/lending')} />
        <StatCard label="Collateral" value={loading ? '...' : `${(onChainCollateral || 0).toFixed(2)} XLM`} sub="Locked in pool contract" color="#f59e0b" icon={Shield} onClick={() => navigate('/lending')} />
        <StatCard label="Health Factor" value={loading ? '...' : onChainHealth !== null ? onChainHealth.toFixed(2) : '—'} sub={healthLabel} color={healthColor} icon={BarChart2} />
      </div>

      {/* Net position */}
      <div className="card" style={{ marginBottom: '2rem', border: `1px solid ${netColor}22`, background: `linear-gradient(135deg, var(--bg-surface) 0%, ${netColor}06 100%)` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: '0.5rem' }}>Net DeFi Position</div>
            <div style={{ fontSize: '2.5rem', fontWeight: 800, fontFamily: 'Orbitron, sans-serif', color: netColor }}>
              {netPosition >= 0 ? '+' : ''}{netPosition.toFixed(2)} XLM
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
              Supplied + FD Locked − Outstanding Debt
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: '0.5rem' }}>Credit Score</div>
            <div style={{ fontSize: '2rem', fontWeight: 800, fontFamily: 'Orbitron, sans-serif', color: scoreColor }}>{creditScore}</div>
            <div style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', borderRadius: '999px', background: `${scoreColor}18`, color: scoreColor, fontWeight: 700, display: 'inline-block', marginTop: '0.35rem' }}>{scoreBand}</div>
          </div>
        </div>
      </div>

      {/* Active loans detail */}
      {activeLoans.length > 0 && (
        <div className="card" style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 className="card-title" style={{ margin: 0 }}>Active Loans</h3>
            <button onClick={() => navigate('/lending')} style={{ fontSize: '0.75rem', color: 'var(--accent-glow)', background: 'none', border: 'none', cursor: 'pointer' }}>Manage →</button>
          </div>
          <div className="table-container">
            <table>
              <thead><tr><th>Loan ID</th><th>Amount</th><th>Rate</th><th>Due</th><th>Remaining</th><th>Status</th></tr></thead>
              <tbody>
                {activeLoans.map((loan, i) => {
                  const daysLate = Math.max(0, Math.ceil((Date.now() - new Date(loan.dueDate)) / 86400000));
                  const remaining = calcRepayAmount(loan.amount, loan.apy, loan.term, daysLate) - loan.amountRepaid;
                  const isOverdue = daysLate > 0;
                  return (
                    <tr key={i}>
                      <td className="mono" style={{ fontSize: '0.72rem', color: 'var(--accent-glow)' }}>{loan.id.slice(-8)}</td>
                      <td style={{ fontWeight: 600 }}>{loan.amount} {loan.asset}</td>
                      <td style={{ color: isOverdue ? '#ef4444' : '#eab308' }}>{(loan.apy + Math.floor(daysLate / 2) * 1.5).toFixed(1)}%</td>
                      <td style={{ color: isOverdue ? '#ef4444' : 'var(--text-muted)', fontWeight: isOverdue ? 700 : 400, fontSize: '0.8rem' }}>
                        {isOverdue ? `${daysLate}d overdue` : new Date(loan.dueDate).toLocaleDateString()}
                      </td>
                      <td style={{ fontWeight: 600, color: isOverdue ? '#ef4444' : 'var(--text-main)' }}>{remaining.toFixed(4)} XLM</td>
                      <td><span className={`badge ${isOverdue ? 'error' : 'warning'}`}>{isOverdue ? 'Overdue' : 'Active'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Active FDs */}
      {activeFDs.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 className="card-title" style={{ margin: 0 }}>Fixed Deposits</h3>
            <button onClick={() => navigate('/lending')} style={{ fontSize: '0.75rem', color: 'var(--accent-glow)', background: 'none', border: 'none', cursor: 'pointer' }}>Manage →</button>
          </div>
          <div className="table-container">
            <table>
              <thead><tr><th>FD ID</th><th>Locked</th><th>APY</th><th>Payout</th><th>Matures</th><th>Status</th></tr></thead>
              <tbody>
                {activeFDs.map((fd, i) => {
                  const matured = new Date(fd.maturesAt) <= new Date();
                  return (
                    <tr key={i}>
                      <td className="mono" style={{ fontSize: '0.72rem', color: 'var(--accent-glow)' }}>
                        {fd.hash ? <a href={`https://stellar.expert/explorer/testnet/tx/${fd.hash}`} target="_blank" rel="noreferrer" style={{ color: 'inherit', display: 'flex', alignItems: 'center', gap: '3px' }}>{fd.id.slice(-8)} <ExternalLink size={10} /></a> : fd.id.slice(-8)}
                      </td>
                      <td style={{ fontWeight: 600, color: '#22c55e' }}>{fd.amount} {fd.asset}</td>
                      <td style={{ color: '#22c55e' }}>{fd.apy}%</td>
                      <td style={{ fontWeight: 600 }}>{fd.payout} {fd.asset}</td>
                      <td style={{ fontSize: '0.8rem', color: matured ? '#10b981' : 'var(--text-muted)' }}>
                        {matured ? 'Matured ✓' : new Date(fd.maturesAt).toLocaleDateString()}
                      </td>
                      <td><span className={`badge ${matured ? 'success' : 'info'}`}>{matured ? 'Claim Now' : 'Active'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {totalSupplied === 0 && activeLoans.length === 0 && activeFDs.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <Landmark size={40} color="var(--text-muted)" style={{ margin: '0 auto 1rem' }} />
          <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>No active positions</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Start by supplying liquidity or creating a fixed deposit.</div>
          <button onClick={() => navigate('/lending')} className="submit-btn" style={{ maxWidth: '200px', margin: '0 auto' }}>Go to Lending →</button>
        </div>
      )}
    </motion.div>
  );
}

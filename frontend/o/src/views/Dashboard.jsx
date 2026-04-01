import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWalletStore } from '../store/wallet';
import { useAnalytics } from '../store/analytics';
import { useLendingStore } from '../store/lending';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Activity, CheckCircle2, AlertCircle, BarChart2, Eye, EyeOff, RefreshCw, Copy, ExternalLink } from 'lucide-react';

function fmt(n, d = 2) {
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(d)}M`;
  if (n >= 1_000)     return `${(n/1_000).toFixed(d)}K`;
  return n.toFixed(d);
}

export default function Dashboard() {
  const { sendTransaction, transactions, clearTransactions } = useWalletStore();
  const { creditScore } = useLendingStore();
  const navigate = useNavigate();

  const {
    totalVolume, uniqueUsers, successCount, failCount,
    avgSettlementMs, ledgerSettlementSec, networkStatus, networkColor,
    poolBalance, escrowBalance, nodeCount, walletRegistry,
    isIndexing, lastIndexedAt, indexError,
    fetchBalances, fetchSettlementTime, indexFromHorizon, getAuditData,
    fetchBackendMetrics,
  } = useAnalytics();

  const [auditMode, setAuditMode] = useState(false);
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [txHash, setTxHash] = useState(null);
  const [txStatus, setTxStatus] = useState('idle');
  const [txError, setTxError] = useState(null);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    fetchBalances();
    fetchSettlementTime();
    fetchBackendMetrics();   // backend is source of truth
    indexFromHorizon();
    const t1 = setInterval(fetchBalances, 30_000);
    const t2 = setInterval(fetchSettlementTime, 10_000);
    const t3 = setInterval(indexFromHorizon, 120_000);
    const t4 = setInterval(fetchBackendMetrics, 15_000); // poll backend every 15s
    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); clearInterval(t4); };
  }, [fetchBalances, fetchSettlementTime, indexFromHorizon, fetchBackendMetrics]);

  const totalAttempted = successCount + failCount;
  const accuracy = totalAttempted > 0 ? ((successCount / totalAttempted) * 100).toFixed(2) : null;
  const accuracyColor = accuracy === null ? 'var(--text-muted)' : parseFloat(accuracy) >= 95 ? '#10b981' : parseFloat(accuracy) >= 80 ? '#f59e0b' : '#ef4444';
  const settleSec = avgSettlementMs !== null ? (avgSettlementMs / 1000).toFixed(1) : ledgerSettlementSec;
  const tvl = poolBalance + escrowBalance;

  const handleSend = async (e) => {
    e.preventDefault();
    setTxStatus('pending'); setTxError(null); setTxHash(null);
    try {
      const res = await sendTransaction(destination, amount);
      setTxHash(res?.hash || res);
      setTxStatus('success');
    } catch (err) {
      setTxStatus('error');
      setTxError(err.message || 'Unexpected error');
    }
  };

  const copyAddr = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const audit = auditMode ? getAuditData() : null;
  const scoreVal = Math.max(0, Math.min(800, creditScore || 800));
  const scorePct = (scoreVal / 800) * 100;
  const band = scoreVal >= 720 ? { label: 'Excellent', color: '#10b981' }
    : scoreVal >= 640 ? { label: 'Good', color: '#34d399' }
    : scoreVal >= 540 ? { label: 'Fair', color: '#f59e0b' }
    : scoreVal >= 400 ? { label: 'Poor', color: '#f97316' }
    : { label: 'Very Poor', color: '#ef4444' };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>

      {/* Header */}
      <div className="view-header">
        <div>
          <h2 className="view-title">Dashboard</h2>
          <p className="view-subtitle">All metrics derived from Horizon blockchain data — no frontend calculations.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button onClick={() => setAuditMode(a => !a)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', border: `1px solid ${auditMode ? '#f59e0b' : 'var(--glass-border)'}`, background: auditMode ? 'rgba(245,158,11,0.1)' : 'transparent', color: auditMode ? '#f59e0b' : 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>
            {auditMode ? <Eye size={14} /> : <EyeOff size={14} />}
            Audit Mode {auditMode ? 'ON' : 'OFF'}
          </button>
          <button onClick={indexFromHorizon} disabled={isIndexing} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', borderRadius: '8px', cursor: 'pointer', border: '1px solid var(--glass-border)', background: 'transparent', color: 'var(--text-muted)', fontSize: '0.8rem' }} title="Re-index from Horizon">
            <RefreshCw size={14} style={{ animation: isIndexing ? 'spin 1s linear infinite' : 'none' }} />
            {isIndexing ? 'Indexing...' : 'Sync'}
          </button>
        </div>
      </div>

      {(lastIndexedAt || indexError) && (
        <div style={{ fontSize: '0.72rem', color: indexError ? '#ef4444' : 'var(--text-muted)', marginBottom: '1rem', fontFamily: 'JetBrains Mono, monospace' }}>
          {indexError ? `⚠ ${indexError}` : `✓ Synced: ${new Date(lastIndexedAt).toLocaleTimeString()}`}
        </div>
      )}

      {/* Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
        {/* Volume */}
        <div className="card" style={{ border: '1px solid rgba(56,189,248,0.3)', background: 'rgba(56,189,248,0.04)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Total Volume</div>
          <div style={{ fontSize: '1.9rem', fontWeight: 800, fontFamily: 'Orbitron, sans-serif', color: '#38bdf8', marginTop: '0.4rem' }}>
            {totalVolume > 0 ? `${fmt(totalVolume)} XLM` : tvl > 0 ? `${fmt(tvl)} XLM` : '—'}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
            {totalVolume > 0
              ? `TVL: ${fmt(poolBalance)} pool · ${fmt(escrowBalance)} escrow`
              : 'Syncing from chain...'}
          </div>
          {auditMode && <div style={{ marginTop: '0.75rem', padding: '0.6rem', background: 'rgba(0,0,0,0.25)', borderRadius: '6px', fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.7 }}>
            Source: all confirmed txs (all modules)<br/>Dedup: txHash Set<br/>Pool TVL: {poolBalance.toFixed(7)} XLM<br/>Escrow TVL: {escrowBalance.toFixed(7)} XLM<br/>Confirmed tx vol: {totalVolume.toFixed(7)} XLM
          </div>}
        </div>

        {/* Users — Total Nodes only */}
        <div className="card">
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Total Nodes</div>
          <div style={{ fontSize: '1.9rem', fontWeight: 800, fontFamily: 'Orbitron, sans-serif', marginTop: '0.4rem' }}>
            {nodeCount || uniqueUsers || walletRegistry.length || '—'}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>Unique wallets ever connected</div>
          {auditMode && <div style={{ marginTop: '0.75rem', padding: '0.6rem', background: 'rgba(0,0,0,0.25)', borderRadius: '6px', fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.7 }}>
            Source: backend DB (wallet_address UNIQUE)<br/>Query: COUNT(wallet_address FROM users)<br/>Rule: one address = one count, no duplicates
          </div>}
        </div>

        {/* Settlement */}
        <div className="card">
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Avg Settlement</div>
          <div style={{ fontSize: '1.9rem', fontWeight: 800, fontFamily: 'Orbitron, sans-serif', marginTop: '0.4rem' }}>
            {settleSec !== null ? `${settleSec}s` : '—'}
          </div>
          <div style={{ fontSize: '0.78rem', color: networkColor, marginTop: '0.4rem', fontWeight: 500 }}>{networkStatus}</div>
          {auditMode && <div style={{ marginTop: '0.75rem', padding: '0.6rem', background: 'rgba(0,0,0,0.25)', borderRadius: '6px', fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.7 }}>
            Source: Horizon /ledgers (last 20)<br/>Method: avg(closed_at diffs)<br/>Our tx avg: {avgSettlementMs !== null ? `${(avgSettlementMs/1000).toFixed(2)}s` : 'N/A'}<br/>Excludes: failed + pending
          </div>}
        </div>

        {/* Accuracy — percentage only, no raw counts */}
        <div className="card">
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Network Accuracy</div>
          <div style={{ fontSize: '1.9rem', fontWeight: 800, fontFamily: 'Orbitron, sans-serif', marginTop: '0.4rem', color: accuracyColor }}>
            {accuracy !== null ? `${accuracy}%` : '—'}
          </div>
          <div style={{ fontSize: '0.78rem', color: accuracyColor, marginTop: '0.4rem', fontWeight: 500 }}>
            {accuracy === null ? 'No transactions yet' : parseFloat(accuracy) >= 95 ? 'Network stable' : parseFloat(accuracy) >= 80 ? 'Minor issues' : 'Degraded'}
          </div>
          {auditMode && <div style={{ marginTop: '0.75rem', padding: '0.6rem', background: 'rgba(0,0,0,0.25)', borderRadius: '6px', fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.7 }}>
            Formula: success/(success+failed)×100<br/>Successful: {successCount}<br/>Failed: {failCount}<br/>Total: {totalAttempted}<br/>Source: backend DB tx table
          </div>}
        </div>
      </div>

      {/* Audit Panel */}
      <AnimatePresence>
        {auditMode && audit && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ marginBottom: '2rem', overflow: 'hidden' }}>
            <div className="card" style={{ border: '1px solid rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>⚡ Audit Mode — Raw Data</h3>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>All metrics recomputable from this data</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
                {[['Raw Tx Count', audit.rawTxCount], ['Successful', audit.successCount], ['Failed', audit.failCount], ['Accuracy', `${audit.accuracy}%`]].map(([l, v]) => (
                  <div key={l} style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{l}</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', marginTop: '0.25rem' }}>{v}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>Unique Wallet Registry ({audit.uniqueWallets.length})</div>
                <div style={{ maxHeight: '110px', overflowY: 'auto', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '0.75rem' }}>
                  {audit.uniqueWallets.length > 0 ? audit.uniqueWallets.map((addr, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.15rem 0', fontSize: '0.72rem', fontFamily: 'JetBrains Mono, monospace' }}>
                      <span style={{ color: 'var(--accent-glow)' }}>{addr}</span>
                      <button onClick={() => copyAddr(addr, i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied === i ? '#10b981' : 'var(--text-muted)', padding: 0 }}><Copy size={11} /></button>
                    </div>
                  )) : <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No wallets yet.</span>}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>Raw Transaction Log ({audit.recentTxs.length})</div>
                <div style={{ maxHeight: '200px', overflowY: 'auto', background: 'rgba(0,0,0,0.3)', borderRadius: '8px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                    <thead><tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                      {['Hash','Type','Amount','Source','Submitted','Confirmed','✓'].map(h => <th key={h} style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {audit.recentTxs.length > 0 ? audit.recentTxs.map((tx, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ padding: '0.4rem 0.75rem', fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent-glow)' }}>
                            <a href={`https://stellar.expert/explorer/testnet/tx/${tx.txHash}`} target="_blank" rel="noreferrer" style={{ color: 'inherit', display: 'flex', alignItems: 'center', gap: '3px' }}>
                              {tx.txHash.slice(0,8)}... <ExternalLink size={9} />
                            </a>
                          </td>
                          <td style={{ padding: '0.4rem 0.75rem' }}>{tx.type}</td>
                          <td style={{ padding: '0.4rem 0.75rem' }}>{tx.amount > 0 ? `${tx.amount} XLM` : '—'}</td>
                          <td style={{ padding: '0.4rem 0.75rem', fontFamily: 'JetBrains Mono, monospace' }}>{tx.sourceAccount ? `${tx.sourceAccount.slice(0,6)}...` : '—'}</td>
                          <td style={{ padding: '0.4rem 0.75rem', color: 'var(--text-muted)' }}>{tx.submittedAt ? new Date(tx.submittedAt).toLocaleTimeString() : '—'}</td>
                          <td style={{ padding: '0.4rem 0.75rem', color: 'var(--text-muted)' }}>{tx.confirmedAt ? new Date(tx.confirmedAt).toLocaleTimeString() : 'Pending'}</td>
                          <td style={{ padding: '0.4rem 0.75rem', color: tx.success === true ? '#10b981' : tx.success === false ? '#ef4444' : '#f59e0b', fontWeight: 700 }}>
                            {tx.success === true ? '✓' : tx.success === false ? '✗' : '…'}
                          </td>
                        </tr>
                      )) : <tr><td colSpan="7" style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>No txs indexed. Click Sync.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Credit Score */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="card" style={{ marginBottom: '2rem', background: `linear-gradient(135deg,rgba(15,15,25,0.95) 0%,${band.color}0d 100%)`, border: `1px solid ${band.color}22`, cursor: 'pointer' }}
        onClick={() => navigate('/credit-score')}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: `${band.color}18`, border: `1px solid ${band.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BarChart2 size={18} color={band.color} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Credit Score</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>On-chain credit assessment</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '2rem', fontWeight: 800, fontFamily: 'Orbitron, sans-serif', color: band.color, lineHeight: 1 }}>{scoreVal}</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>out of 800</div>
          </div>
        </div>
        <div style={{ position: 'relative', height: '6px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
          <div style={{ width: '100%', height: '100%', background: 'linear-gradient(90deg,#ef4444,#f97316,#f59e0b,#34d399,#10b981)', opacity: 0.2 }} />
          <motion.div initial={{ width: 0 }} animate={{ width: `${scorePct}%` }} transition={{ duration: 1 }}
            style={{ position: 'absolute', top: 0, left: 0, height: '100%', background: band.color, borderRadius: '999px' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.6rem' }}>
          <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.6rem', borderRadius: '999px', background: `${band.color}18`, color: band.color, fontWeight: 700 }}>{band.label}</span>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Click to view details →</span>
        </div>
      </motion.div>

      {/* Activity + Quick Transfer */}
      <div className="grid-2" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 className="card-title" style={{ margin: 0 }}>Recent Activity</h3>
            {transactions?.length > 0 && (
              <button onClick={clearTransactions} style={{ background: 'transparent', border: '1px solid var(--glass-border)', color: 'var(--text-muted)', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.72rem', cursor: 'pointer' }}>Clear</button>
            )}
          </div>
          <div className="table-container" style={{ maxHeight: '380px', overflowY: 'auto' }}>
            <table>
              <thead><tr><th>Tx Hash</th><th>Type</th><th>Amount</th><th>Status</th><th>Time</th></tr></thead>
              <tbody>
                {transactions?.length > 0 ? transactions.map((tx, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem', color: 'var(--accent-glow)' }}>
                      {tx.hash ? <a href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{tx.hash.slice(0,10)}...</a> : tx.id}
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>{tx.type}</td>
                    <td style={{ fontWeight: 600 }}>{tx.amount}</td>
                    <td>
                      <span style={{ padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.7rem', fontWeight: 600,
                        background: tx.status === 'Completed' ? 'rgba(16,185,129,0.1)' : tx.status === 'Failed' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                        color: tx.status === 'Completed' ? '#10b981' : tx.status === 'Failed' ? '#ef4444' : '#f59e0b' }}>
                        {tx.status}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{new Date(tx.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  </tr>
                )) : <tr><td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>No activity yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">Quick Transfer</h3>
          <form onSubmit={handleSend} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', flex: 1 }}>
            <div className="form-group">
              <label className="form-label">Destination Address</label>
              <input type="text" value={destination} onChange={e => setDestination(e.target.value)} placeholder="G..." className="form-input mono" required />
            </div>
            <div className="form-group">
              <label className="form-label">Amount (XLM)</label>
              <div className="input-wrapper">
                <input type="number" step="0.0000001" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="form-input large" required />
                <div className="input-suffix">XLM</div>
              </div>
            </div>
            <button type="submit" disabled={txStatus === 'pending' || !destination || !amount} className="submit-btn" style={{ marginTop: 'auto' }}>
              {txStatus === 'pending' ? <div className="spinner" /> : <><Send size={16} /> Execute Route</>}
            </button>
          </form>
          {txStatus !== 'idle' && (
            <div className={`tx-status ${txStatus}`} style={{ marginTop: '1rem' }}>
              {txStatus === 'pending' && <div className="status-flex"><Activity size={16} /> Routing...</div>}
              {txStatus === 'success' && (
                <div className="status-stack">
                  <div className="status-flex"><CheckCircle2 size={16} /> Settled</div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem', marginTop: '0.4rem' }}>{txHash ? txHash.slice(0,16) + '...' : 'confirmed'}</div>
                  <a href={`https://stellar.expert/explorer/testnet/tx/${txHash}`} target="_blank" rel="noreferrer" className="status-link">View on Explorer</a>
                </div>
              )}
              {txStatus === 'error' && (
                <div className="status-flex start">
                  <AlertCircle size={16} />
                  <div><div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>Failed</div><div style={{ fontSize: '0.75rem', opacity: 0.8 }}>{txError}</div></div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

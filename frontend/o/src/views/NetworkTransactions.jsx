import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAnalytics } from '../store/analytics';
import { Activity, CheckCircle2, XCircle, ExternalLink, RefreshCw } from 'lucide-react';

export default function NetworkTransactions() {
  const { eventLog, isIndexing, indexFromHorizon, fetchBackendMetrics } = useAnalytics();
  const [filter, setFilter] = useState('all'); // all | success | failed | pending

  useEffect(() => {
    indexFromHorizon();
    fetchBackendMetrics();
    const t = setInterval(() => { indexFromHorizon(); fetchBackendMetrics(); }, 30_000);
    return () => clearInterval(t);
  }, [indexFromHorizon, fetchBackendMetrics]);

  // Dedup and filter
  const seen = new Set();
  const deduped = eventLog.filter(e => {
    if (seen.has(e.txHash)) return false;
    seen.add(e.txHash);
    return true;
  });

  const filtered = deduped.filter(e => {
    if (filter === 'success') return e.success === true;
    if (filter === 'failed')  return e.success === false;
    if (filter === 'pending') return e.success === null;
    return true;
  });

  const stats = {
    total:   deduped.length,
    success: deduped.filter(e => e.success === true).length,
    failed:  deduped.filter(e => e.success === false).length,
    pending: deduped.filter(e => e.success === null).length,
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="view-header">
        <div>
          <h2 className="view-title">Network Transactions</h2>
          <p className="view-subtitle">Real-time on-chain activity — all transactions across the network.</p>
        </div>
        <button onClick={indexFromHorizon} disabled={isIndexing}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', border: '1px solid var(--glass-border)', background: 'transparent', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          <RefreshCw size={14} style={{ animation: isIndexing ? 'spin 1s linear infinite' : 'none' }} />
          {isIndexing ? 'Syncing...' : 'Sync from Horizon'}
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        {[
          { label: 'Total Txs', value: stats.total, color: 'var(--text-main)' },
          { label: 'Successful', value: stats.success, color: '#10b981' },
          { label: 'Failed', value: stats.failed, color: '#ef4444' },
          { label: 'Pending', value: stats.pending, color: '#f59e0b' },
        ].map((s, i) => (
          <div key={i} className="card" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'Orbitron, sans-serif', color: s.color, marginTop: '0.35rem' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {[['all','All'],['success','Success'],['failed','Failed'],['pending','Pending']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)} style={{
            padding: '0.4rem 1rem', borderRadius: '999px', border: '1px solid',
            borderColor: filter === val ? 'var(--accent-glow)' : 'var(--glass-border)',
            background: filter === val ? 'rgba(168,85,247,0.1)' : 'transparent',
            color: filter === val ? 'var(--accent-glow)' : 'var(--text-muted)',
            cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
          }}>{label}</button>
        ))}
      </div>

      {/* Transaction table */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-container" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Tx Hash</th>
                <th>Type</th>
                <th>Amount</th>
                <th>From</th>
                <th>Submitted</th>
                <th>Confirmed</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length > 0 ? filtered.map((tx, i) => (
                <tr key={i}>
                  <td>
                    {tx.success === true  && <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#10b981', fontSize: '0.8rem', fontWeight: 600 }}><CheckCircle2 size={14} /> Success</span>}
                    {tx.success === false && <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#ef4444', fontSize: '0.8rem', fontWeight: 600 }}><XCircle size={14} /> Failed</span>}
                    {tx.success === null  && <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#f59e0b', fontSize: '0.8rem', fontWeight: 600 }}><Activity size={14} /> Pending</span>}
                  </td>
                  <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem' }}>
                    {tx.txHash
                      ? <a href={`https://stellar.expert/explorer/testnet/tx/${tx.txHash}`} target="_blank" rel="noreferrer"
                          style={{ color: 'var(--accent-glow)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {tx.txHash.slice(0, 10)}... <ExternalLink size={11} />
                        </a>
                      : '—'}
                  </td>
                  <td>
                    <span style={{ padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600,
                      background: 'rgba(168,85,247,0.1)', color: '#a855f7' }}>
                      {tx.type || 'Transfer'}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600, color: tx.amount > 0 ? '#10b981' : 'var(--text-muted)' }}>
                    {tx.amount > 0 ? `${tx.amount.toFixed(4)} XLM` : '—'}
                  </td>
                  <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {tx.sourceAccount ? `${tx.sourceAccount.slice(0,6)}...${tx.sourceAccount.slice(-4)}` : '—'}
                  </td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {tx.submittedAt ? new Date(tx.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                  </td>
                  <td style={{ fontSize: '0.8rem', color: tx.confirmedAt ? '#10b981' : 'var(--text-muted)' }}>
                    {tx.confirmedAt ? new Date(tx.confirmedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Pending'}
                  </td>
                </tr>
              )) : (
                <tr><td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
                  No transactions yet. Click Sync to load from Horizon.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}

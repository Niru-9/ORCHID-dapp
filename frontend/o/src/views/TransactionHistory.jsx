/**
 * Transaction History
 * ───────────────────
 * Pulls all on-chain transactions for the connected wallet from Horizon.
 * Shows real blockchain data — not just local state.
 */
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useWalletStore } from '../store/wallet';
import { ExternalLink, RefreshCw, Filter, Download } from 'lucide-react';

const HORIZON = 'https://horizon-testnet.stellar.org';
const PAGE_SIZE = 50;

const TYPE_COLORS = {
  payment:                    { color: '#38bdf8',  label: 'Payment' },
  create_account:             { color: '#10b981',  label: 'Create Account' },
  path_payment_strict_send:   { color: '#a855f7',  label: 'Path Payment' },
  path_payment_strict_receive:{ color: '#a855f7',  label: 'Path Payment' },
  manage_sell_offer:          { color: '#f59e0b',  label: 'Trade' },
  manage_buy_offer:           { color: '#f59e0b',  label: 'Trade' },
  set_options:                { color: '#6b7280',  label: 'Set Options' },
  change_trust:               { color: '#6b7280',  label: 'Change Trust' },
  invoke_host_function:       { color: '#ef4444',  label: 'Contract Call' },
};

function getOpType(op) {
  const t = TYPE_COLORS[op.type];
  return t || { color: '#6b7280', label: op.type?.replace(/_/g, ' ') || 'Unknown' };
}

function formatAmount(op) {
  if (op.amount) return `${parseFloat(op.amount).toFixed(4)} ${op.asset_type === 'native' ? 'XLM' : op.asset_code || ''}`;
  if (op.starting_balance) return `${parseFloat(op.starting_balance).toFixed(4)} XLM`;
  return '—';
}

export default function TransactionHistory() {
  const { address } = useWalletStore();
  const [txs, setTxs] = useState([]);
  const [ops, setOps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState('operations'); // 'operations' | 'transactions'

  const fetchOps = useCallback(async (reset = false) => {
    if (!address || loading) return;
    setLoading(true);
    try {
      const cur = reset ? '' : (cursor ? `&cursor=${cursor}` : '');
      const url = `${HORIZON}/accounts/${address}/operations?order=desc&limit=${PAGE_SIZE}${cur}`;
      const res = await fetch(url);
      const data = await res.json();
      const records = data._embedded?.records || [];

      if (reset) {
        setOps(records);
      } else {
        setOps(prev => [...prev, ...records]);
      }

      const last = records[records.length - 1];
      setCursor(last?.paging_token || null);
      setHasMore(records.length === PAGE_SIZE);
    } catch (err) {
      console.error('Failed to fetch operations:', err);
    }
    setLoading(false);
  }, [address, cursor, loading]);

  const fetchTxs = useCallback(async (reset = false) => {
    if (!address || loading) return;
    setLoading(true);
    try {
      const cur = reset ? '' : (cursor ? `&cursor=${cursor}` : '');
      const url = `${HORIZON}/accounts/${address}/transactions?order=desc&limit=${PAGE_SIZE}&include_failed=true${cur}`;
      const res = await fetch(url);
      const data = await res.json();
      const records = data._embedded?.records || [];

      if (reset) {
        setTxs(records);
      } else {
        setTxs(prev => [...prev, ...records]);
      }

      const last = records[records.length - 1];
      setCursor(last?.paging_token || null);
      setHasMore(records.length === PAGE_SIZE);
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
    }
    setLoading(false);
  }, [address, cursor, loading]);

  useEffect(() => {
    if (!address) return;
    setCursor(null);
    setHasMore(true);
    if (view === 'operations') fetchOps(true);
    else fetchTxs(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, view]);

  const handleRefresh = () => {
    setCursor(null);
    setHasMore(true);
    if (view === 'operations') fetchOps(true);
    else fetchTxs(true);
  };

  const filteredOps = ops.filter(op => {
    if (filter === 'all') return true;
    if (filter === 'payments') return ['payment', 'path_payment_strict_send', 'path_payment_strict_receive', 'create_account'].includes(op.type);
    if (filter === 'contracts') return op.type === 'invoke_host_function';
    return true;
  });

  const exportCSV = () => {
    const rows = [['Time', 'Type', 'Amount', 'From', 'To', 'Tx Hash']];
    filteredOps.forEach(op => {
      rows.push([
        new Date(op.created_at).toISOString(),
        op.type,
        formatAmount(op),
        op.source_account || '',
        op.to || op.account || '',
        op.transaction_hash || '',
      ]);
    });
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `orchid-history-${address?.slice(0,8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!address) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="view-header"><h2 className="view-title">Transaction History</h2></div>
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ color: 'var(--text-muted)' }}>Connect your wallet to view transaction history.</div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="view-header">
        <div>
          <h2 className="view-title">Transaction History</h2>
          <p className="view-subtitle">All on-chain activity for your wallet — pulled directly from Horizon.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={exportCSV} disabled={filteredOps.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.875rem', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}>
            <Download size={14} /> Export CSV
          </button>
          <button onClick={handleRefresh} disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.875rem', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}>
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* View + Filter tabs */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '0.25rem' }}>
          {[['operations','Operations'],['transactions','Transactions']].map(([v,l]) => (
            <button key={v} onClick={() => setView(v)} style={{ padding: '0.4rem 0.875rem', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, background: view === v ? 'rgba(168,85,247,0.15)' : 'transparent', color: view === v ? 'var(--accent-glow)' : 'var(--text-muted)' }}>{l}</button>
          ))}
        </div>
        {view === 'operations' && (
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {[['all','All'],['payments','Payments'],['contracts','Contracts']].map(([v,l]) => (
              <button key={v} onClick={() => setFilter(v)} style={{ padding: '0.4rem 0.875rem', borderRadius: '999px', border: `1px solid ${filter === v ? 'var(--accent-glow)' : 'var(--glass-border)'}`, background: filter === v ? 'rgba(168,85,247,0.1)' : 'transparent', color: filter === v ? 'var(--accent-glow)' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>{l}</button>
            ))}
          </div>
        )}
      </div>

      {/* Operations table */}
      {view === 'operations' && (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-container" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
            <table>
              <thead><tr><th>Time</th><th>Type</th><th>Amount</th><th>From</th><th>To</th><th>Tx</th></tr></thead>
              <tbody>
                {filteredOps.length > 0 ? filteredOps.map((op, i) => {
                  const { color, label } = getOpType(op);
                  return (
                    <tr key={i}>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {new Date(op.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td><span style={{ padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600, background: `${color}18`, color }}>{label}</span></td>
                      <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>{formatAmount(op)}</td>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {op.source_account ? `${op.source_account.slice(0,6)}...${op.source_account.slice(-4)}` : '—'}
                      </td>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {(op.to || op.account) ? `${(op.to || op.account).slice(0,6)}...${(op.to || op.account).slice(-4)}` : '—'}
                      </td>
                      <td>
                        {op.transaction_hash && (
                          <a href={`https://stellar.expert/explorer/testnet/tx/${op.transaction_hash}`} target="_blank" rel="noreferrer"
                            style={{ display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--accent-glow)', fontSize: '0.72rem', fontFamily: 'JetBrains Mono, monospace' }}>
                            {op.transaction_hash.slice(0,8)}... <ExternalLink size={10} />
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
                    {loading ? 'Loading...' : 'No operations found.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {hasMore && !loading && (
            <div style={{ padding: '1rem', textAlign: 'center', borderTop: '1px solid var(--glass-border)' }}>
              <button onClick={() => fetchOps(false)} className="action-btn" style={{ margin: '0 auto' }}>Load More</button>
            </div>
          )}
        </div>
      )}

      {/* Transactions table */}
      {view === 'transactions' && (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-container" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
            <table>
              <thead><tr><th>Time</th><th>Hash</th><th>Operations</th><th>Fee</th><th>Status</th></tr></thead>
              <tbody>
                {txs.length > 0 ? txs.map((tx, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(tx.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem' }}>
                      <a href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`} target="_blank" rel="noreferrer"
                        style={{ color: 'var(--accent-glow)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                        {tx.hash.slice(0,10)}... <ExternalLink size={10} />
                      </a>
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>{tx.operation_count}</td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{(parseInt(tx.fee_charged) / 1e7).toFixed(5)} XLM</td>
                    <td>
                      <span className={`badge ${tx.successful ? 'success' : 'error'}`}>
                        {tx.successful ? 'Success' : 'Failed'}
                      </span>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
                    {loading ? 'Loading...' : 'No transactions found.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {hasMore && !loading && (
            <div style={{ padding: '1rem', textAlign: 'center', borderTop: '1px solid var(--glass-border)' }}>
              <button onClick={() => fetchTxs(false)} className="action-btn" style={{ margin: '0 auto' }}>Load More</button>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

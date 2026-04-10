/**
 * Activity — combines Tx History (my wallet) + Live Transactions (network-wide)
 */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWalletStore } from '../store/wallet';
import { useAnalytics } from '../store/analytics';
import { Activity as ActivityIcon, CheckCircle2, XCircle, ExternalLink, RefreshCw, Download } from 'lucide-react';

const HORIZON = 'https://horizon-testnet.stellar.org';
const PAGE_SIZE = 50;

const TYPE_COLORS = {
  payment:                     { color: '#38bdf8', label: 'Payment' },
  create_account:              { color: '#10b981', label: 'Create Account' },
  path_payment_strict_send:    { color: '#a855f7', label: 'Path Payment' },
  path_payment_strict_receive: { color: '#a855f7', label: 'Path Payment' },
  invoke_host_function:        { color: '#ef4444', label: 'Contract Call' },
  manage_sell_offer:           { color: '#f59e0b', label: 'Trade' },
  manage_buy_offer:            { color: '#f59e0b', label: 'Trade' },
};

function getOpType(op) {
  return TYPE_COLORS[op.type] || { color: '#6b7280', label: op.type?.replace(/_/g, ' ') || 'Unknown' };
}

function formatAmount(op) {
  if (op.amount) return `${parseFloat(op.amount).toFixed(4)} ${op.asset_type === 'native' ? 'XLM' : op.asset_code || ''}`;
  if (op.starting_balance) return `${parseFloat(op.starting_balance).toFixed(4)} XLM`;
  return '—';
}

// ── My History Tab ────────────────────────────────────────────────────────────
function MyHistory({ address }) {
  const [ops, setOps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [filter, setFilter] = useState('all');

  const fetchOps = useCallback(async (reset = false) => {
    if (!address || loading) return;
    setLoading(true);
    try {
      const cur = reset ? '' : (cursor ? `&cursor=${cursor}` : '');
      const data = await fetch(`${HORIZON}/accounts/${address}/operations?order=desc&limit=${PAGE_SIZE}${cur}`).then(r => r.json());
      const records = data._embedded?.records || [];
      if (reset) setOps(records); else setOps(p => [...p, ...records]);
      setCursor(records[records.length - 1]?.paging_token || null);
      setHasMore(records.length === PAGE_SIZE);
    } catch (_) {}
    setLoading(false);
  }, [address, cursor, loading]);

  useEffect(() => {
    if (!address) return;
    setCursor(null); setHasMore(true); fetchOps(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const filtered = ops.filter(op => {
    if (filter === 'payments') return ['payment','path_payment_strict_send','path_payment_strict_receive','create_account'].includes(op.type);
    if (filter === 'contracts') return op.type === 'invoke_host_function';
    return true;
  });

  const exportCSV = () => {
    const rows = [['Time','Type','Amount','From','To','Tx Hash']];
    filtered.forEach(op => rows.push([new Date(op.created_at).toISOString(), op.type, formatAmount(op), op.source_account||'', op.to||op.account||'', op.transaction_hash||'']));
    const blob = new Blob([rows.map(r=>r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `orchid-history-${address?.slice(0,8)}.csv`; a.click();
  };

  if (!address) return <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Connect your wallet to view history.</div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {[['all','All'],['payments','Payments'],['contracts','Contracts']].map(([v,l]) => (
            <button key={v} onClick={() => setFilter(v)} style={{ padding: '0.35rem 0.875rem', borderRadius: '999px', border: `1px solid ${filter===v?'var(--accent-glow)':'var(--glass-border)'}`, background: filter===v?'rgba(168,85,247,0.1)':'transparent', color: filter===v?'var(--accent-glow)':'var(--text-muted)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>{l}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={exportCSV} disabled={filtered.length===0} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.875rem', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.78rem' }}><Download size={13} /> CSV</button>
          <button onClick={() => { setCursor(null); setHasMore(true); fetchOps(true); }} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.875rem', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.78rem' }}><RefreshCw size={13} style={{ animation: loading?'spin 1s linear infinite':'none' }} /> Refresh</button>
        </div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="table-container" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
          <table>
            <thead><tr><th>Time</th><th>Type</th><th>Amount</th><th>From</th><th>To</th><th>Tx</th></tr></thead>
            <tbody>
              {filtered.length > 0 ? filtered.map((op, i) => {
                const { color, label } = getOpType(op);
                return (
                  <tr key={i}>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(op.created_at).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
                    <td><span style={{ padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600, background: `${color}18`, color }}>{label}</span></td>
                    <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>{formatAmount(op)}</td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{op.source_account?`${op.source_account.slice(0,6)}...${op.source_account.slice(-4)}`:'—'}</td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{(op.to||op.account)?`${(op.to||op.account).slice(0,6)}...${(op.to||op.account).slice(-4)}`:'—'}</td>
                    <td>{op.transaction_hash&&<a href={`https://stellar.expert/explorer/testnet/tx/${op.transaction_hash}`} target="_blank" rel="noreferrer" style={{ color:'var(--accent-glow)', display:'flex', alignItems:'center', gap:'3px', fontSize:'0.72rem', fontFamily:'JetBrains Mono, monospace' }}>{op.transaction_hash.slice(0,8)}... <ExternalLink size={10}/></a>}</td>
                  </tr>
                );
              }) : <tr><td colSpan="6" style={{ textAlign:'center', color:'var(--text-muted)', padding:'3rem 0' }}>{loading?'Loading...':'No operations found.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {hasMore && !loading && <div style={{ padding:'1rem', textAlign:'center', borderTop:'1px solid var(--glass-border)' }}><button onClick={()=>fetchOps(false)} className="action-btn" style={{ margin:'0 auto' }}>Load More</button></div>}
      </div>
    </div>
  );
}

// ── Network Live Tab ──────────────────────────────────────────────────────────
function NetworkLive() {
  const { eventLog, isIndexing, indexFromHorizon, fetchBackendMetrics } = useAnalytics();

  useEffect(() => {
    indexFromHorizon(); fetchBackendMetrics();
    const t = setInterval(() => { indexFromHorizon(); fetchBackendMetrics(); }, 30_000);
    return () => clearInterval(t);
  }, [indexFromHorizon, fetchBackendMetrics]);

  const [filter, setFilter] = useState('all');
  const seen = new Set();
  const deduped = eventLog.filter(e => { if (seen.has(e.txHash)) return false; seen.add(e.txHash); return true; });
  const filtered = deduped.filter(e => filter==='success'?e.success===true:filter==='failed'?e.success===false:filter==='pending'?e.success===null:true);
  const stats = { total: deduped.length, success: deduped.filter(e=>e.success===true).length, failed: deduped.filter(e=>e.success===false).length, pending: deduped.filter(e=>e.success===null).length };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
        {[['Total',stats.total,'var(--text-main)'],['Success',stats.success,'#10b981'],['Failed',stats.failed,'#ef4444'],['Pending',stats.pending,'#f59e0b']].map(([l,v,c],i)=>(
          <div key={i} className="card" style={{ padding:'0.75rem', textAlign:'center' }}>
            <div style={{ fontSize:'0.65rem', color:'var(--text-muted)', textTransform:'uppercase', fontWeight:600 }}>{l}</div>
            <div style={{ fontSize:'1.4rem', fontWeight:800, fontFamily:'Orbitron,sans-serif', color:c, marginTop:'0.2rem' }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ display:'flex', gap:'0.4rem', marginBottom:'1.25rem' }}>
        {[['all','All'],['success','Success'],['failed','Failed'],['pending','Pending']].map(([v,l])=>(
          <button key={v} onClick={()=>setFilter(v)} style={{ padding:'0.35rem 0.875rem', borderRadius:'999px', border:`1px solid ${filter===v?'var(--accent-glow)':'var(--glass-border)'}`, background:filter===v?'rgba(168,85,247,0.1)':'transparent', color:filter===v?'var(--accent-glow)':'var(--text-muted)', cursor:'pointer', fontSize:'0.78rem', fontWeight:600 }}>{l}</button>
        ))}
        <button onClick={indexFromHorizon} disabled={isIndexing} style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:'0.4rem', padding:'0.35rem 0.875rem', borderRadius:'8px', border:'1px solid var(--glass-border)', background:'transparent', color:'var(--text-muted)', cursor:'pointer', fontSize:'0.78rem' }}>
          <RefreshCw size={13} style={{ animation:isIndexing?'spin 1s linear infinite':'none' }} />{isIndexing?'Syncing...':'Sync'}
        </button>
      </div>
      <div className="card" style={{ padding:0 }}>
        <div className="table-container" style={{ maxHeight:'55vh', overflowY:'auto' }}>
          <table>
            <thead><tr><th>Status</th><th>Tx Hash</th><th>Type</th><th>Amount</th><th>From</th><th>Time</th></tr></thead>
            <tbody>
              {filtered.length>0?filtered.map((tx,i)=>(
                <tr key={i}>
                  <td>{tx.success===true?<span style={{display:'flex',alignItems:'center',gap:'0.3rem',color:'#10b981',fontSize:'0.8rem',fontWeight:600}}><CheckCircle2 size={13}/>OK</span>:tx.success===false?<span style={{display:'flex',alignItems:'center',gap:'0.3rem',color:'#ef4444',fontSize:'0.8rem',fontWeight:600}}><XCircle size={13}/>Fail</span>:<span style={{display:'flex',alignItems:'center',gap:'0.3rem',color:'#f59e0b',fontSize:'0.8rem',fontWeight:600}}><ActivityIcon size={13}/>Pending</span>}</td>
                  <td style={{fontFamily:'JetBrains Mono,monospace',fontSize:'0.72rem'}}>{tx.txHash?<a href={`https://stellar.expert/explorer/testnet/tx/${tx.txHash}`} target="_blank" rel="noreferrer" style={{color:'var(--accent-glow)',display:'flex',alignItems:'center',gap:'3px'}}>{tx.txHash.slice(0,10)}... <ExternalLink size={10}/></a>:'—'}</td>
                  <td><span style={{padding:'0.2rem 0.5rem',borderRadius:'999px',fontSize:'0.7rem',fontWeight:600,background:'rgba(168,85,247,0.1)',color:'#a855f7'}}>{tx.type||'Transfer'}</span></td>
                  <td style={{fontWeight:600,color:tx.amount>0?'#10b981':'var(--text-muted)'}}>{tx.amount>0?`${tx.amount.toFixed(4)} XLM`:'—'}</td>
                  <td style={{fontFamily:'JetBrains Mono,monospace',fontSize:'0.72rem',color:'var(--text-muted)'}}>{tx.sourceAccount?`${tx.sourceAccount.slice(0,6)}...${tx.sourceAccount.slice(-4)}`:'—'}</td>
                  <td style={{fontSize:'0.78rem',color:'var(--text-muted)'}}>{tx.submittedAt?new Date(tx.submittedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—'}</td>
                </tr>
              )):<tr><td colSpan="6" style={{textAlign:'center',color:'var(--text-muted)',padding:'3rem 0'}}>No transactions. Click Sync.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Activity() {
  const { address } = useWalletStore();
  const [tab, setTab] = useState('mine');

  return (
    <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }}>
      <div className="view-header">
        <div>
          <h2 className="view-title">Activity</h2>
          <p className="view-subtitle">Your transaction history and live network activity in one place.</p>
        </div>
      </div>

      <div style={{ display:'flex', gap:'0.75rem', marginBottom:'2rem', background:'rgba(255,255,255,0.03)', border:'1px solid var(--glass-border)', borderRadius:'12px', padding:'0.4rem' }}>
        {[['mine','My History'],['network','Network Live']].map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{ flex:1, padding:'0.65rem 1rem', borderRadius:'8px', border:'none', cursor:'pointer', fontWeight:600, fontSize:'0.875rem', background:tab===id?'rgba(56,189,248,0.1)':'transparent', color:tab===id?'var(--accent-glow)':'var(--text-muted)', borderBottom:tab===id?'2px solid var(--accent-glow)':'2px solid transparent', transition:'all 0.2s' }}>{label}</button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{opacity:0,x:10}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-10}} transition={{duration:0.15}}>
          {tab==='mine' ? <MyHistory address={address} /> : <NetworkLive />}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

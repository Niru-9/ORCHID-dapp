/**
 * Monitor — Live system health and monitoring dashboard
 * Shows: API health, Redis status, Horizon status, uptime, memory, metrics
 */
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, Server, Database, Globe, Clock, Cpu, Activity } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://orchid-dapp.onrender.com';
const HORIZON  = 'https://horizon-testnet.stellar.org';

function StatusBadge({ status }) {
  const cfg = {
    ok:       { color: '#10b981', bg: 'rgba(16,185,129,0.1)',  icon: <CheckCircle2 size={14}/>, label: 'Operational' },
    healthy:  { color: '#10b981', bg: 'rgba(16,185,129,0.1)',  icon: <CheckCircle2 size={14}/>, label: 'Healthy' },
    degraded: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  icon: <AlertTriangle size={14}/>, label: 'Degraded' },
    error:    { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   icon: <XCircle size={14}/>, label: 'Error' },
    checking: { color: '#6b7280', bg: 'rgba(107,114,128,0.1)', icon: <RefreshCw size={14} style={{animation:'spin 1s linear infinite'}}/>, label: 'Checking...' },
  }[status] || { color: '#6b7280', bg: 'rgba(107,114,128,0.1)', icon: <AlertTriangle size={14}/>, label: 'Unknown' };

  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:'0.35rem', padding:'0.25rem 0.65rem', borderRadius:'999px', background:cfg.bg, color:cfg.color, fontSize:'0.75rem', fontWeight:700 }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function MetricCard({ icon: Icon, label, value, sub, color = 'var(--accent-glow)' }) {
  return (
    <div className="card" style={{ padding:'1rem' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'0.6rem', marginBottom:'0.5rem' }}>
        <Icon size={16} color={color} />
        <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', fontWeight:600 }}>{label}</div>
      </div>
      <div style={{ fontSize:'1.5rem', fontWeight:800, fontFamily:'Orbitron,sans-serif', color }}>{value}</div>
      {sub && <div style={{ fontSize:'0.75rem', color:'var(--text-muted)', marginTop:'0.25rem' }}>{sub}</div>}
    </div>
  );
}

export default function Monitor() {
  const [health, setHealth]     = useState(null);
  const [monitor, setMonitor]   = useState(null);
  const [horizon, setHorizon]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [lastCheck, setLastCheck] = useState(null);
  const [history, setHistory]   = useState([]); // last 20 health checks

  const runChecks = useCallback(async () => {
    setLoading(true);
    const ts = new Date();

    // Backend health
    try {
      const r = await fetch(`${API_BASE}/health`);
      const d = await r.json();
      setHealth(d);
      setHistory(prev => [{
        time: ts.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}),
        status: d.status,
        ms: d.response_time_ms,
      }, ...prev].slice(0, 20));
    } catch (e) {
      setHealth({ status: 'error', error: e.message });
      setHistory(prev => [{ time: ts.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}), status: 'error', ms: null }, ...prev].slice(0, 20));
    }

    // Backend monitor metrics
    try {
      const r = await fetch(`${API_BASE}/api/monitor`);
      setMonitor(await r.json());
    } catch (_) {}

    // Horizon direct check
    try {
      const start = Date.now();
      const r = await fetch(`${HORIZON}/ledgers?limit=1&order=desc`);
      const d = await r.json();
      const ledger = d._embedded?.records?.[0];
      setHorizon({
        status: r.ok ? 'ok' : 'degraded',
        latest_ledger: ledger?.sequence,
        closed_at: ledger?.closed_at,
        response_ms: Date.now() - start,
      });
    } catch (e) {
      setHorizon({ status: 'error', message: e.message });
    }

    setLastCheck(ts);
    setLoading(false);
  }, []);

  useEffect(() => {
    runChecks();
    const t = setInterval(runChecks, 30_000); // auto-refresh every 30s
    return () => clearInterval(t);
  }, [runChecks]);

  const overallStatus = !health ? 'checking'
    : health.status === 'healthy' && horizon?.status === 'ok' ? 'healthy'
    : health.status === 'error' || horizon?.status === 'error' ? 'error'
    : 'degraded';

  return (
    <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }}>
      <div className="view-header">
        <div>
          <div className="section-label">Infrastructure Health</div>
          <h2 className="view-title">System Monitor</h2>
          <p className="view-subtitle">
            Live health checks for every layer of the Orchid stack — the backend API, Upstash Redis database, and Stellar Horizon. If any layer goes down, you'll see it here before users do. Auto-refreshes every 30 seconds.
          </p>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
          {lastCheck && <span style={{ fontSize:'0.75rem', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace' }}>Last: {lastCheck.toLocaleTimeString()}</span>}
          <button onClick={runChecks} disabled={loading} style={{ display:'flex', alignItems:'center', gap:'0.4rem', padding:'0.5rem 1rem', borderRadius:'8px', border:'1px solid var(--glass-border)', background:'transparent', color:'var(--text-muted)', cursor:'pointer', fontSize:'0.8rem' }}>
            <RefreshCw size={14} style={{ animation:loading?'spin 1s linear infinite':'none' }} />
            {loading ? 'Checking...' : 'Refresh Now'}
          </button>
        </div>
      </div>

      {/* Overall status banner */}
      <div className="card" style={{ marginBottom:'2.5rem', border:`1px solid ${overallStatus==='healthy'?'rgba(16,185,129,0.3)':overallStatus==='error'?'rgba(239,68,68,0.3)':'rgba(245,158,11,0.3)'}`, background:`${overallStatus==='healthy'?'rgba(16,185,129,0.05)':overallStatus==='error'?'rgba(239,68,68,0.05)':'rgba(245,158,11,0.05)'}` }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'1rem' }}>
            <div style={{ fontSize:'1.1rem', fontWeight:700 }}>Overall System Status</div>
            <StatusBadge status={overallStatus} />
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 480 }}>
            {overallStatus === 'healthy'
              ? 'All systems are operating normally. Backend API, Redis database, and Stellar Horizon are all responding within expected thresholds.'
              : overallStatus === 'degraded'
              ? 'One or more services are responding slowly or returning unexpected results. Transactions may be delayed.'
              : 'A critical service is down. Payments and contract interactions may fail until the issue is resolved.'}
          </p>
        </div>
      </div>

      {/* Service checks */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))', gap:'1.25rem', marginBottom:'2.5rem' }}>

        {/* Backend API */}
        <div className="card" style={{ borderTop: '2px solid #a855f7' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.75rem' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'0.6rem' }}>
              <Server size={18} color="#a855f7" />
              <span style={{ fontWeight:700, fontSize: '1rem' }}>Backend API</span>
            </div>
            <StatusBadge status={health ? health.status : 'checking'} />
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.65, marginBottom: '1rem' }}>
            The Express.js backend running on Render. Handles wallet registration, transaction recording, metrics aggregation, and health reporting. All frontend data flows through this service.
          </p>
          {health && (
            <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
              <div className="metric-row"><span className="metric-key">Response time</span><span className="metric-val" style={{ color: health.response_time_ms < 500 ? '#10b981' : health.response_time_ms < 1500 ? '#f59e0b' : '#ef4444' }}>{health.response_time_ms}ms</span></div>
              <div className="metric-row"><span className="metric-key">Network</span><span className="metric-val">{health.network || 'testnet'}</span></div>
              <div className="metric-row" style={{ borderBottom: 'none' }}><span className="metric-key">Version</span><span className="metric-val" style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.78rem' }}>{health.version || '—'}</span></div>
            </div>
          )}
        </div>

        {/* Redis */}
        <div className="card" style={{ borderTop: '2px solid #38bdf8' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.75rem' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'0.6rem' }}>
              <Database size={18} color="#38bdf8" />
              <span style={{ fontWeight:700, fontSize: '1rem' }}>Upstash Redis</span>
            </div>
            <StatusBadge status={health?.checks?.redis?.status || 'checking'} />
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.65, marginBottom: '1rem' }}>
            Persistent key-value store hosted on Upstash. Stores wallet registry, transaction history, and protocol metrics. Data survives backend restarts and is accessible globally with sub-millisecond latency.
          </p>
          {health?.checks?.redis && (
            <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
              <div className="metric-row"><span className="metric-key">Registered nodes</span><span className="metric-val" style={{ color:'#38bdf8' }}>{health.checks.redis.total_nodes ?? '—'}</span></div>
              <div className="metric-row" style={{ borderBottom: 'none' }}><span className="metric-key">Recorded transactions</span><span className="metric-val">{health.checks.redis.total_txs ?? '—'}</span></div>
            </div>
          )}
        </div>

        {/* Horizon */}
        <div className="card" style={{ borderTop: '2px solid #10b981' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.75rem' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'0.6rem' }}>
              <Globe size={18} color="#10b981" />
              <span style={{ fontWeight:700, fontSize: '1rem' }}>Stellar Horizon</span>
            </div>
            <StatusBadge status={horizon ? horizon.status : 'checking'} />
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.65, marginBottom: '1rem' }}>
            Stellar's public API layer for the testnet blockchain. Orchid uses Horizon to submit transactions, index operations, fetch account balances, and measure ledger settlement times.
          </p>
          {horizon && (
            <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
              <div className="metric-row"><span className="metric-key">Latest ledger</span><span className="metric-val" style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.78rem' }}>{horizon.latest_ledger ?? '—'}</span></div>
              <div className="metric-row"><span className="metric-key">Response time</span><span className="metric-val" style={{ color: horizon.response_ms < 500 ? '#10b981' : '#f59e0b' }}>{horizon.response_ms}ms</span></div>
              <div className="metric-row" style={{ borderBottom: 'none' }}><span className="metric-key">Last ledger close</span><span className="metric-val" style={{ color:'var(--text-muted)', fontSize:'0.78rem' }}>{horizon.closed_at ? new Date(horizon.closed_at).toLocaleTimeString() : '—'}</span></div>
            </div>
          )}
        </div>
      </div>

      {/* Runtime metrics */}
      {monitor && (
        <div style={{ marginBottom: '2.5rem' }}>
          <div className="section-label" style={{ marginBottom: '0.75rem' }}>Runtime Metrics</div>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: '1.25rem', maxWidth: 640 }}>
            Live server stats from the backend process. Memory usage reflects the Node.js heap. Uptime resets on each Render deployment or restart.
          </p>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:'1.25rem' }}>
            <MetricCard icon={Clock} label="Uptime" value={monitor.uptime_seconds >= 3600 ? `${Math.floor(monitor.uptime_seconds/3600)}h ${Math.floor((monitor.uptime_seconds%3600)/60)}m` : `${Math.floor(monitor.uptime_seconds/60)}m`} sub="Since last restart" color="#a855f7" />
            <MetricCard icon={Cpu} label="Memory Used" value={`${monitor.memory_mb} MB`} sub="Node.js heap" color="#38bdf8" />
            <MetricCard icon={Activity} label="Registered Nodes" value={monitor.total_nodes ?? '—'} sub="Unique wallets in DB" color="#10b981" />
            <MetricCard icon={Activity} label="Total Transactions" value={monitor.total ?? '—'} sub={`${monitor.successful ?? 0} ok · ${monitor.failed ?? 0} failed`} color="#f59e0b" />
            <MetricCard icon={Activity} label="Success Rate" value={monitor.accuracy ? `${parseFloat(monitor.accuracy).toFixed(1)}%` : '—'} sub="Confirmed / total" color={parseFloat(monitor.accuracy) >= 95 ? '#10b981' : '#f59e0b'} />
          </div>
        </div>
      )}

      {/* Health check history */}
      {history.length > 0 && (
        <div className="card">
          <h3 className="card-title" style={{ marginBottom:'1rem' }}>Health Check History (last 20)</h3>
          <div style={{ display:'flex', gap:'4px', alignItems:'flex-end', height:'48px' }}>
            {[...history].reverse().map((h, i) => (
              <div key={i} title={`${h.time} — ${h.status}${h.ms ? ` (${h.ms}ms)` : ''}`}
                style={{
                  flex:1, borderRadius:'3px',
                  height: h.ms ? `${Math.min(100, Math.max(20, 100 - h.ms/20))}%` : '30%',
                  background: h.status==='healthy'||h.status==='ok' ? '#10b981' : h.status==='degraded' ? '#f59e0b' : '#ef4444',
                  opacity: 0.7 + (i / history.length) * 0.3,
                  cursor:'pointer',
                }}
              />
            ))}
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', marginTop:'0.5rem', fontSize:'0.7rem', color:'var(--text-muted)' }}>
            <span>Oldest</span>
            <span>Latest</span>
          </div>
        </div>
      )}

      {/* Contracts */}
      <div className="card" style={{ marginTop:'1.5rem' }}>
        <h3 className="card-title" style={{ marginBottom:'1rem' }}>Deployed Contracts</h3>
        <div style={{ display:'flex', flexDirection:'column', gap:'0.75rem' }}>
          {[
            { name: 'Orchid Escrow', id: import.meta.env.VITE_ESCROW_CONTRACT_ID, color: '#f59e0b' },
            { name: 'Orchid Pool', id: import.meta.env.VITE_POOL_CONTRACT_ID, color: '#10b981' },
          ].map((c, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0.75rem', background:'rgba(0,0,0,0.2)', borderRadius:'8px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
                <div style={{ width:'8px', height:'8px', borderRadius:'50%', background:c.color }} />
                <span style={{ fontWeight:600, fontSize:'0.875rem' }}>{c.name}</span>
              </div>
              {c.id ? (
                <a href={`https://stellar.expert/explorer/testnet/contract/${c.id}`} target="_blank" rel="noreferrer"
                  style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'0.72rem', color:'var(--accent-glow)', display:'flex', alignItems:'center', gap:'4px' }}>
                  {c.id.slice(0,8)}...{c.id.slice(-6)}
                </a>
              ) : <span style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>Not configured</span>}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

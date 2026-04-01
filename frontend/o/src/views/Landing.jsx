import { useEffect } from 'react';
import { useWalletStore } from '../store/wallet';
import { useNetworkStats } from '../store/networkStats';
import { useAnalytics } from '../store/analytics';
import { motion } from 'framer-motion';
import { ArrowRight, Hexagon, Download } from 'lucide-react';

export default function Landing() {
  const { isConnecting, error, connect, resetConnection } = useWalletStore();

  const {
    knownAddresses,
    nodeCount: networkNodeCount,
    settlementTime,
    networkColor,
    fetchSettlementTime,
    globalSuccessTxs,
    globalFailedTxs,
  } = useNetworkStats();

  const {
    totalVolume,
    poolBalance,
    escrowBalance,
    successCount,
    failCount,
    nodeCount: analyticsNodeCount,
    fetchBalances,
    fetchBackendMetrics,
  } = useAnalytics();

  // Backend node count is most accurate; fall back through layers
  const nodes = analyticsNodeCount || networkNodeCount || knownAddresses.length;

  useEffect(() => {
    fetchSettlementTime();
    fetchBalances();
    fetchBackendMetrics();
    const t1 = setInterval(fetchSettlementTime, 10_000);
    const t2 = setInterval(fetchBackendMetrics, 15_000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [fetchSettlementTime, fetchBalances, fetchBackendMetrics]);

  // Accuracy — backend is source of truth, fall back to networkStats
  const totalAttempted = (successCount || 0) + (failCount || 0);
  const globalTotal   = totalAttempted > 0 ? totalAttempted : (globalSuccessTxs || 0) + (globalFailedTxs || 0);
  const globalSuccess = totalAttempted > 0 ? successCount   : (globalSuccessTxs || 0);
  const successRate   = globalTotal > 0
    ? ((globalSuccess / globalTotal) * 100).toFixed(1)
    : '100.0';

  // Volume — backend total, fall back to TVL
  const displayVolume = totalVolume > 0 ? totalVolume : (poolBalance + escrowBalance);

  const formattedVolume = displayVolume > 1_000_000_000
    ? `${(displayVolume / 1_000_000_000).toFixed(2)}B XLM`
    : displayVolume > 1_000_000
    ? `${(displayVolume / 1_000_000).toFixed(2)}M XLM`
    : displayVolume > 1_000
    ? `${(displayVolume / 1_000).toFixed(2)}K XLM`
    : displayVolume > 0
    ? `${displayVolume.toFixed(4)} XLM`
    : 'Initializing...';

  return (
    <div style={{ overflowY: 'auto', height: '100vh', paddingBottom: '100px', width: '100%' }}>
      
      <header className="landing-header" style={{ width: '100%', padding: '2rem' }}>
        <div className="landing-logo">
          <div className="landing-logo-icon">
            <Hexagon size={16} color="white" />
          </div>
          ORCHID
        </div>
      </header>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="hero-section"
        style={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: '4rem 0 2rem 0' }}
      >
        <div className="hero-badge">v2.0 Interstellar Protocol Live</div>
        
        <h1 className="hero-title">ORCHID</h1>
        
        <p className="hero-subtitle">
          Optimized Real-time Cross-border Hub for Intelligent Disbursements.
        </p>

        <div className="hero-actions">
  <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', alignItems: 'flex-start' }}>

    {/* LEFT SIDE (CONNECT + RESET) */}
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      
      <button
        onClick={connect}
        disabled={false}
        className="hero-btn primary"
      >
        {isConnecting ? 'Connecting...' : 'Connect Wallet'}
        <ArrowRight size={18} />
      </button>

      {/* RESET BELOW CONNECT */}
      <button
        onClick={resetConnection}
        className="hero-btn secondary"
        style={{ padding: '6px 12px', fontSize: '0.8rem', marginTop: '6px' }}
      >
        Reset
      </button>

    </div>

    {/* RIGHT SIDE (WHITEPAPER aligned with CONNECT) */}
    <a 
      href="/Orchid_Whitepaper.docx" 
      download="Orchid_Whitepaper.docx"
      className="hero-btn secondary"
      style={{ textDecoration: 'none' }}
    >
      <Download size={18} style={{ marginRight: '8px' }} />
      Read Whitepaper
    </a>

  </div>
</div>

{error && (
  <div className="error-banner" style={{ marginTop: '2rem' }}>
    <p>{error}</p>
  </div>
)}
      </motion.div>

      <div className="landing-stats" style={{ 
        width: '100%', 
        marginTop: '2rem', 
        marginBottom: '4rem', 
        background: 'rgba(5, 5, 5, 0.85)', 
        backdropFilter: 'blur(12px)',
        borderTop: '1px solid rgba(255,255,255,0.05)', 
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        padding: '1.5rem 4rem'
      }}>
        <div className="landing-stat">
          <span className="landing-stat-val">{nodes > 0 ? nodes.toLocaleString() : '—'}</span>
          <span className="landing-stat-label">TOTAL NODES</span>
        </div>

        <div className="landing-stat">
          <span className="landing-stat-val" style={{ color: networkColor }}>
            {settlementTime !== null ? `${settlementTime}s` : 'Measuring...'}
          </span>
          <span className="landing-stat-label">SETTLEMENT FINALITY</span>
        </div>

        <div className="landing-stat">
          <span className="landing-stat-val">{successRate}%</span>
          <span className="landing-stat-label">NETWORK ACCURACY</span>
        </div>

        <div className="landing-stat">
          <span className="landing-stat-val">{formattedVolume}</span>
          <span className="landing-stat-label">TOTAL SETTLEMENT VOLUME</span>
        </div>
      </div>

    </div>
  );
}
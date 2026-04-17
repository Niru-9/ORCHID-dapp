import { useEffect } from 'react';
import { useWalletStore } from '../store/wallet';
import { useNetworkStats } from '../store/networkStats';
import { useAnalytics } from '../store/analytics';
import { ArrowRight, Hexagon, Download } from 'lucide-react';

export default function Landing() {
  const { isConnecting, error, connect, resetConnection } = useWalletStore();

  const { knownAddresses, nodeCount: networkNodeCount, settlementTime, networkColor, fetchSettlementTime } = useNetworkStats();
  const { totalVolume, successCount, failCount, nodeCount: analyticsNodeCount, fetchBalances, fetchBackendMetrics, backendAccuracy } = useAnalytics();

  const nodes = analyticsNodeCount || networkNodeCount || knownAddresses.length;

  useEffect(() => {
    fetchSettlementTime();
    fetchBalances();
    fetchBackendMetrics();
    const t1 = setInterval(fetchSettlementTime, 10_000);
    const t2 = setInterval(fetchBackendMetrics, 15_000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [fetchSettlementTime, fetchBalances, fetchBackendMetrics]);

  // Use backend accuracy (real Redis value) — fall back to local only if not yet fetched
  const totalAttempted = (successCount || 0) + (failCount || 0);
  const successRate = backendAccuracy !== null && backendAccuracy !== undefined
    ? backendAccuracy.toFixed(1)
    : totalAttempted > 0
    ? ((successCount / totalAttempted) * 100).toFixed(1)
    : '—';

  const formattedVolume = totalVolume > 1_000_000_000
    ? `${(totalVolume / 1_000_000_000).toFixed(2)}B XLM`
    : totalVolume > 1_000_000
    ? `${(totalVolume / 1_000_000).toFixed(2)}M XLM`
    : totalVolume > 1_000
    ? `${(totalVolume / 1_000).toFixed(2)}K XLM`
    : totalVolume > 0
    ? `${totalVolume.toFixed(4)} XLM`
    : '—';

  return (
    <div style={{ overflowY: 'auto', height: '100vh', width: '100%', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>

      {/* ── Header — logo only, no nav buttons ── */}
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '1.5rem 4rem', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ width: 32, height: 32, background: '#C9A857', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Hexagon size={16} color="#0E0E10" />
          </div>
          <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: '1.25rem', letterSpacing: '0.05em', color: '#F5F5F5' }}>ORCHID</span>
          <span style={{ fontSize: '0.7rem', color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.1em', marginLeft: '0.25rem' }}>Payment Protocol</span>
        </div>
      </header>

      {/* ── Hero ── */}
      <section style={{ padding: '6rem 4rem 4rem', maxWidth: 900, margin: '0 auto', textAlign: 'center' }}>
        <div style={{
          display: 'inline-block', background: 'rgba(201,168,87,0.1)', color: '#C9A857',
          border: '1px solid rgba(201,168,87,0.2)', padding: '0.35rem 1rem',
          borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.08em',
          textTransform: 'uppercase', marginBottom: '2rem',
        }}>
          ● Live on Stellar Testnet
        </div>

        <h1 style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 'clamp(1.9rem, 5vw, 2.75rem)', fontWeight: 600, lineHeight: 1.15, marginBottom: '1.5rem', letterSpacing: '-0.02em', color: '#F5F5F5' }}>
          Send money globally<br />
          <span style={{ color: '#C9A857' }}>in seconds</span>
        </h1>

        <p style={{ color: '#A1A1AA', fontSize: '0.95rem', lineHeight: 1.75, maxWidth: 460, margin: '0 auto 1rem' }}>
          Orchid is a fully on-chain payment router built on Stellar Soroban. No intermediaries, no platform fees, no opaque settlement windows.
        </p>
        <p style={{ color: '#71717A', fontSize: '0.875rem', lineHeight: 1.7, maxWidth: 440, margin: '0 auto 2.5rem' }}>
          Instant settlement · Secure · On-chain
        </p>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={connect} disabled={isConnecting} style={{
            background: '#C9A857', color: '#0E0E10', border: 'none',
            padding: '0.875rem 2rem', borderRadius: '10px', fontWeight: 600,
            fontSize: '0.9rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem',
            transition: 'background 0.2s ease',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = '#B8963F'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#C9A857'; }}
          >
            {isConnecting ? 'Connecting…' : 'Send Money'} <ArrowRight size={16} />
          </button>
          <a href="/Orchid_Whitepaper.docx" download style={{
            background: 'transparent', color: '#A1A1AA',
            border: '1px solid #27272A', padding: '0.875rem 1.5rem',
            borderRadius: '10px', fontWeight: 500, fontSize: '0.9rem',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none',
            transition: 'border-color 0.2s ease, color 0.2s ease',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = '#F5F5F5'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#27272A'; e.currentTarget.style.color = '#A1A1AA'; }}
          >
            <Download size={16} /> Read Synopsis
          </a>
        </div>

        {/* Reset connection — shown below CTAs */}
        <div style={{ marginTop: '0.875rem', textAlign: 'center' }}>
          <button
            onClick={resetConnection}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#71717A', fontSize: '0.78rem', textDecoration: 'underline',
              textUnderlineOffset: '2px', transition: 'color 0.2s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#A1A1AA'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#71717A'; }}
          >
            Reset connection
          </button>
        </div>

        {error && (
          <div style={{ marginTop: '1.5rem', background: 'var(--error-bg)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--error-text)', padding: '1rem 1.25rem', borderRadius: '0.75rem', fontSize: '0.875rem' }}>
            {error} — <button onClick={resetConnection} style={{ background: 'none', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}>Reset</button>
          </div>
        )}
      </section>

      {/* ── Live Stats Bar ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)', padding: '2rem 4rem',
      }}>
        {[
          { val: nodes > 0 ? nodes.toLocaleString() : '—', label: 'Active Nodes' },
          { val: settlementTime !== null ? `${settlementTime}s` : '—', label: 'Settlement Finality', color: networkColor },
          { val: `${successRate}%`, label: 'Network Accuracy' },
          { val: formattedVolume, label: 'Total Volume Settled' },
        ].map(({ val, label, color }) => (
          <div key={label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: color || '#fff', marginBottom: '0.25rem' }}>{val}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* ── Problem / Solution ── */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', borderBottom: '1px solid var(--border)' }}>
        <div style={{ padding: '4rem', borderRight: '1px solid var(--border)' }}>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '1.5rem', lineHeight: 1.2 }}>
            Traditional payments are broken
          </h2>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.8, marginBottom: '1rem', fontSize: '0.95rem' }}>
            A small set of banks and processors decide who can send money and where. The process is opaque — senders never know why transfers fail, and the criteria shift based on compliance policies that change daily.
          </p>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.8, marginBottom: '1rem', fontSize: '0.95rem' }}>
            Geography matters more than need. The same handful of corridors get fast settlement. Everyone else waits 3–5 business days and pays 5–8% in fees.
          </p>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.8, fontSize: '0.95rem' }}>
            Intermediaries take a cut at every step. By the time money reaches the recipient, a significant portion has been extracted by people who added no value to the transfer.
          </p>
        </div>
        <div style={{ padding: '4rem' }}>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '1.5rem', lineHeight: 1.2 }}>
            Replace the middleman with code
          </h2>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.8, marginBottom: '1rem', fontSize: '0.95rem' }}>
            Orchid puts every rule on-chain. Who can send, how escrow is released, when collateral is liquidated — all enforced by a Rust smart contract on Stellar Soroban. No human can override it.
          </p>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.8, marginBottom: '1rem', fontSize: '0.95rem' }}>
            Any wallet can send. Any wallet can receive. Geography is irrelevant. Connections are irrelevant. The contract doesn't care.
          </p>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.8, fontSize: '0.95rem' }}>
            Zero platform fees. Funds flow directly from sender wallets through the smart contract to recipients. The only cost is the Stellar network base fee — fractions of a cent per transaction.
          </p>
        </div>
      </section>

      {/* ── Principles ── */}
      <section style={{ padding: '5rem 4rem', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600, marginBottom: '1rem' }}>PRINCIPLES</div>
        <h2 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '3rem' }}>Built on three ideas</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0', borderTop: '1px solid var(--border)' }}>
          {[
            {
              title: 'TRANSPARENCY BY DEFAULT',
              body: 'Every payment, every escrow release, every liquidation is a blockchain transaction. Anyone can verify the full history of any account at any time. There are no private channels, no off-chain decisions.',
            },
            {
              title: 'CODE OVER COMMITTEES',
              body: 'The smart contract is the only authority. It cannot be bribed, lobbied, or pressured. It applies the same rules to every participant regardless of who they are or where they\'re from.',
            },
            {
              title: 'DIRECT VALUE FLOW',
              body: 'Money moves from sender wallets to the contract to recipient wallets. No platform extracts a percentage. The only friction is the Stellar base fee — a fraction of a cent per operation.',
            },
          ].map((p, i) => (
            <div key={i} style={{ padding: '2.5rem 2rem', borderRight: i < 2 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: '1rem' }}>{p.title}</div>
              <p style={{ color: 'var(--text-muted)', lineHeight: 1.8, fontSize: '0.9rem' }}>{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section style={{ padding: '5rem 4rem', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600, marginBottom: '1rem' }}>PROCESS</div>
        <h2 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '3rem' }}>Four steps, fully on-chain</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', borderTop: '1px solid var(--border)' }}>
          {[
            { n: '01', title: 'CONNECT WALLET', body: 'Connect any Stellar-compatible wallet — Freighter, WalletConnect, or xBull. Your keys stay with you. Orchid never holds custody of your funds.' },
            { n: '02', title: 'ROUTE PAYMENTS', body: 'Send XLM or any Stellar asset to any address globally. The Payment Hub finds the optimal path, records the transaction on-chain, and settles in under 5 seconds.' },
            { n: '03', title: 'LOCK IN ESCROW', body: 'Create a smart escrow with custom release conditions. Funds are locked in the Soroban contract until conditions are met — no third-party arbitration needed.' },
            { n: '04', title: 'EARN & BORROW', body: 'Supply liquidity to the lending pool and earn dynamic APY. Borrow against your XLM collateral with on-chain credit scoring. Fixed deposits earn up to 15% APY.' },
          ].map((s, i) => (
            <div key={i} style={{
              padding: '2.5rem 2rem',
              borderRight: i % 2 === 0 ? '1px solid var(--border)' : 'none',
              borderBottom: i < 2 ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.75rem' }}>{s.n}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: '0.75rem' }}>{s.title}</div>
              <p style={{ color: 'var(--text-muted)', lineHeight: 1.8, fontSize: '0.9rem' }}>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '2rem 4rem', borderTop: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ width: 24, height: 24, background: 'var(--accent)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Hexagon size={12} color="white" />
          </div>
          <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: '0.9rem' }}>ORCHID</span>
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>BUILT ON STELLAR SOROBAN · 2025</span>
        <div style={{ display: 'flex', gap: '1.5rem' }}>
          {['STELLAR', 'SOROBAN', 'GITHUB'].map(l => (
            <span key={l} style={{ fontSize: '0.75rem', color: 'var(--text-muted)', letterSpacing: '0.08em', cursor: 'pointer' }}>{l}</span>
          ))}
        </div>
      </footer>

    </div>
  );
}

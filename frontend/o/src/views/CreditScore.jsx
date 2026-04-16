import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useWalletStore } from '../store/wallet';
import { useLendingStore } from '../store/lending';

// Score bands aligned with real-world credit systems (max 800)
const SCORE_MAX = 800;
const SCORE_MIN = 0;

function getScoreBand(score) {
  if (score >= 720) return { label: 'Excellent', color: '#10b981', bg: 'rgba(16,185,129,0.12)', desc: 'Best interest rates. Maximum borrowing capacity.' };
  if (score >= 640) return { label: 'Good', color: '#34d399', bg: 'rgba(52,211,153,0.10)', desc: 'Favourable terms. Most products available.' };
  if (score >= 540) return { label: 'Fair', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', desc: 'Eligible for most products at standard rates.' };
  if (score >= 400) return { label: 'Poor', color: '#f97316', bg: 'rgba(249,115,22,0.12)', desc: 'Limited access. Higher interest rate applied.' };
  return { label: 'Very Poor', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', desc: 'Restricted access. Penalty rates apply.' };
}

// SVG Arc Gauge (like the semicircle in the reference image)
function ArcGauge({ score }) {
  const pct = Math.max(0, Math.min(1, score / SCORE_MAX));

  // Arc params
  const cx = 160, cy = 145, r = 110;
  const startAngle = -180; // left
  const endAngle = 0;       // right
  const toRad = (deg) => (deg * Math.PI) / 180;

  const arcPath = (from, to) => {
    const s = { x: cx + r * Math.cos(toRad(from)), y: cy + r * Math.sin(toRad(from)) };
    const e = { x: cx + r * Math.cos(toRad(to)), y: cy + r * Math.sin(toRad(to)) };
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
  };

  // Needle angle: maps 0→800 to -180→0 degrees
  const needleAngle = startAngle + pct * 180;
  const needleX = cx + (r - 20) * Math.cos(toRad(needleAngle));
  const needleY = cy + (r - 20) * Math.sin(toRad(needleAngle));

  // Color stops across the arc (5 bands)
  const colorBands = [
    { from: -180, to: -144, color: '#ef4444' },
    { from: -144, to: -108, color: '#f97316' },
    { from: -108, to: -72, color: '#f59e0b' },
    { from: -72, to: -36, color: '#34d399' },
    { from: -36, to: 0, color: '#10b981' },
  ];

  const band = getScoreBand(score);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width="320" height="190" viewBox="0 0 320 190">
        {/* Track */}
        <path d={arcPath(-180, 0)} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="20" strokeLinecap="round" />

        {/* Color bands */}
        {colorBands.map((b, i) => (
          <path key={i} d={arcPath(b.from, b.to)} fill="none" stroke={b.color} strokeWidth="18" strokeLinecap={i === 0 ? 'round' : i === 4 ? 'round' : 'butt'} opacity="0.75" />
        ))}

        {/* Active fill up to needle position */}
        {pct > 0 && (
          <path d={arcPath(-180, needleAngle)} fill="none" stroke={band.color} strokeWidth="20" strokeLinecap="round" opacity="0.4" />
        )}

        {/* Needle */}
        <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke="white" strokeWidth="3" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="8" fill="white" />
        <circle cx={cx} cy={cy} r="4" fill="#0a0a0f" />

        {/* Range labels - moved further out */}
        <text x="30" y="165" fill="rgba(255,255,255,0.4)" fontSize="11" fontFamily="monospace">0</text>
        <text x="280" y="165" fill="rgba(255,255,255,0.4)" fontSize="11" fontFamily="monospace">800</text>

        {/* Band labels - repositioned to avoid overlap */}
        <text x="15" y="110" fill="#ef4444" fontSize="8" fontFamily="monospace" opacity="0.6">POOR</text>
        <text x="160" y="20" fill="#f59e0b" fontSize="8" fontFamily="monospace" opacity="0.6" textAnchor="middle">FAIR</text>
        <text x="295" y="110" fill="#10b981" fontSize="8" fontFamily="monospace" opacity="0.6" textAnchor="end">GOOD</text>
      </svg>

      {/* Score display */}
      <div style={{ textAlign: 'center', marginTop: '-0.5rem' }}>
        <div style={{ fontSize: '3.5rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: band.color, lineHeight: 1 }}>
          {score}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          out of {SCORE_MAX}
        </div>
        <div style={{ display: 'inline-block', marginTop: '0.75rem', padding: '0.3rem 1rem', borderRadius: '999px', background: band.bg, color: band.color, fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.05em' }}>
          {band.label}
        </div>
      </div>
    </div>
  );
}

// Horizontal progress bar (like reference image)
function ScoreBar({ score }) {
  const pct = (score / SCORE_MAX) * 100;
  const gradient = 'linear-gradient(90deg, #ef4444 0%, #f97316 25%, #f59e0b 50%, #34d399 75%, #10b981 100%)';

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <div style={{ position: 'relative', height: '16px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{ width: '100%', height: '100%', background: gradient, borderRadius: '999px', opacity: 0.3 }} />
        {/* Thumb */}
        <div style={{
          position: 'absolute', top: '50%', left: `${pct}%`, transform: 'translate(-50%, -50%)',
          width: '20px', height: '20px', borderRadius: '50%', background: 'white',
          boxShadow: '0 0 0 3px rgba(0,0,0,0.5), 0 0 12px rgba(255,255,255,0.3)',
          border: '3px solid white'
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem' }}>
        <span style={{ fontSize: '0.7rem', color: '#ef4444', fontWeight: 600 }}>LOW</span>
        <span style={{ fontSize: '0.7rem', color: '#10b981', fontWeight: 600 }}>HIGH</span>
      </div>
    </div>
  );
}

export default function CreditScore() {
  const { transactions } = useWalletStore();
  const { creditScore, loans } = useLendingStore();
  const score = Math.max(SCORE_MIN, Math.min(SCORE_MAX, creditScore ?? 800));
  const band = getScoreBand(score);

  // Per-loan late penalty calculation summary (from lending store loans)
  const latePayments = useMemo(() => {
    return loans
      .filter(l => l.status === 'Completed' && l.paidAt && l.dueDate)
      .map(l => {
        const due = new Date(l.dueDate).getTime();
        const paid = new Date(l.paidAt).getTime();
        const daysLate = Math.max(0, Math.ceil((paid - due) / (1000 * 60 * 60 * 24)));
        return { id: l.id, amount: l.amount, daysLate, penalty: daysLate * 5, paidAt: l.paidAt, onTime: daysLate === 0 };
      });
  }, [loans]);

  const factors = [
    { label: 'Payment History', weight: 35, impact: latePayments.filter(l => !l.onTime).length > 0 ? 'Negative' : 'Positive', color: latePayments.filter(l => !l.onTime).length > 0 ? '#ef4444' : '#10b981' },
    { label: 'Credit Utilization', weight: 30, impact: score > 640 ? 'Low' : 'High', color: score > 640 ? '#10b981' : '#f97316' },
    { label: 'Account History', weight: 15, impact: loans.length > 0 ? 'Established' : 'New', color: loans.length > 0 ? '#10b981' : '#f59e0b' },
    { label: 'Transaction Diversity', weight: 10, impact: transactions.length > 5 ? 'Good' : 'Building', color: transactions.length > 5 ? '#10b981' : '#f59e0b' },
    { label: 'Delinquency Index', weight: 10, impact: latePayments.some(l => l.daysLate > 7) ? 'Flagged' : 'Clean', color: latePayments.some(l => l.daysLate > 7) ? '#ef4444' : '#10b981' },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="view-header">
        <div>
          <div className="section-label">On-Chain Credit Assessment</div>
          <h2 className="view-title">Credit Score</h2>
          <p className="view-subtitle">
            Your credit score is calculated entirely on-chain from your repayment history, credit utilization, account age, and transaction diversity. It updates automatically on every confirmed repayment — no manual input, no human review, no way to game it.
          </p>
        </div>
      </div>

      {/* ─── Warning Notice (only visible when overdue loans exist) ─── */}
      {latePayments.some(l => !l.onTime) && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.7rem 1rem',
            marginBottom: '1.5rem',
            borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <span style={{ fontSize: '1rem', flexShrink: 0 }}>⚠️</span>
          <div>
            <span style={{ fontSize: '0.82rem', color: '#ef4444', fontWeight: 600 }}>Payment overdue. </span>
            <span style={{ fontSize: '0.82rem', color: 'rgba(239,68,68,0.8)' }}>Your credit score is decreasing by 5 points per day until the balance is repaid.</span>
          </div>
        </motion.div>
      )}

      {/* ─── PRIMARY: Full-Width Arc Gauge Card ─── */}
      <div
        className="card"
        style={{
          background: `linear-gradient(135deg, rgba(15,15,25,0.95) 0%, ${band.bg} 100%)`,
          border: `1px solid ${band.color}30`,
          marginBottom: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '2.5rem 2rem 2rem',
        }}
      >
        <h3 className="card-title" style={{ textAlign: 'center', marginBottom: '0.5rem', fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Your Credit Score</h3>
        <ArcGauge score={score} />
        <div style={{ width: '100%', maxWidth: '360px', marginTop: '0.5rem' }}>
          <ScoreBar score={score} />
        </div>
        <p style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '1rem', lineHeight: '1.6', maxWidth: '420px' }}>
          {band.desc}
        </p>
      </div>

      {/* ─── SECONDARY: Score Factors + Score Ranges ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {/* Score Factors */}
        <div className="card">
          <div className="card-title">Score Factors</div>
          <div className="card-subtitle">These five factors determine your score. Each is weighted by its real-world importance to creditworthiness.</div>
          {[
            { label: 'Payment History', weight: 35, impact: latePayments.filter(l => !l.onTime).length > 0 ? 'Negative' : 'Positive', color: latePayments.filter(l => !l.onTime).length > 0 ? '#ef4444' : '#10b981', desc: 'Whether you repay loans on time. The single most important factor — one late payment deducts 5 points per day.' },
            { label: 'Credit Utilization', weight: 30, impact: score > 640 ? 'Low' : 'High', color: score > 640 ? '#10b981' : '#f97316', desc: 'How much of your available borrowing capacity you are using. Lower utilization signals responsible credit management.' },
            { label: 'Account History', weight: 15, impact: loans.length > 0 ? 'Established' : 'New', color: loans.length > 0 ? '#10b981' : '#f59e0b', desc: 'Length of your credit history on Orchid. Longer history with consistent repayments builds a stronger score.' },
            { label: 'Transaction Diversity', weight: 10, impact: transactions.length > 5 ? 'Good' : 'Building', color: transactions.length > 5 ? '#10b981' : '#f59e0b', desc: 'Variety of transaction types — payments, escrow, lending. Diverse activity demonstrates broader protocol engagement.' },
            { label: 'Delinquency Index', weight: 10, impact: latePayments.some(l => l.daysLate > 7) ? 'Flagged' : 'Clean', color: latePayments.some(l => l.daysLate > 7) ? '#ef4444' : '#10b981', desc: 'Whether you have any severely overdue payments (7+ days late). A clean record here protects your score floor.' },
          ].map((f, i) => (
            <div key={i} style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--text-main)', fontWeight: 600 }}>{f.label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', color: f.color, fontWeight: 700 }}>{f.impact}</span>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.06)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>{f.weight}%</span>
                </div>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '0.5rem' }}>{f.desc}</p>
              <div style={{ height: '5px', background: 'rgba(255,255,255,0.07)', borderRadius: '999px', overflow: 'hidden' }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${f.weight * 3}%` }}
                  transition={{ delay: i * 0.1, duration: 0.6 }}
                  style={{ height: '100%', background: f.color, borderRadius: '999px', opacity: 0.8 }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Score Ranges */}
        <div className="card">
          <div className="card-title">Score Ranges</div>
          <div className="card-subtitle">What each score band means for your access to Orchid's lending products and the interest rates you'll receive.</div>
          {[
            { range: '720 – 800', label: 'Excellent', color: '#10b981', desc: 'Best available rates. Maximum borrowing capacity. All products unlocked.' },
            { range: '640 – 719', label: 'Good', color: '#34d399', desc: 'Favourable terms. Most lending products available at competitive rates.' },
            { range: '540 – 639', label: 'Fair', color: '#f59e0b', desc: 'Standard rates apply. Eligible for most products. Room to improve.' },
            { range: '400 – 539', label: 'Poor', color: '#f97316', desc: 'Limited access. Higher interest rates. Focus on repaying existing debt.' },
            { range: '0 – 399', label: 'Very Poor', color: '#ef4444', desc: 'Borrowing restricted. Penalty rates apply. Repay all overdue loans first.' },
          ].map((b, i) => (
            <div key={i} style={{ padding: '0.875rem 0', borderBottom: i < 4 ? '1px solid var(--glass-border)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: b.color, flexShrink: 0 }} />
                  <span style={{ fontSize: '0.875rem', color: b.color, fontWeight: 700 }}>{b.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{b.range}</span>
                  {score >= parseInt(b.range) && score <= parseInt(b.range.split('–')[1]) && (
                    <span style={{ fontSize: '0.65rem', background: b.color, color: 'white', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: 700 }}>You</span>
                  )}
                </div>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.6, paddingLeft: '1.4rem' }}>{b.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Repayment Impact Log ─── */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <h3 className="card-title" style={{ marginBottom: '0.75rem' }}>Repayment Impact Log</h3>

        {/* Bold compact notice bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.6rem',
          padding: '0.55rem 1rem', marginBottom: '1rem', borderRadius: '7px',
          background: 'rgba(239,68,68,0.09)', border: '1px solid rgba(239,68,68,0.22)',
        }}>
          <span style={{ fontSize: '0.9rem', flexShrink: 0 }}>⚠️</span>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#ef4444' }}>
            Every missed installment deducts{' '}
            <span style={{ textDecoration: 'underline', textUnderlineOffset: '2px' }}>5 credit points</span>
            {' '}— pay on time to protect your score.
          </span>
        </div>

      </div>

      {/* Borrow/Repay Activity */}
      {loans.length > 0 && (
        <div className="card">
          <h3 className="card-title" style={{ marginBottom: '1rem' }}>Credit Activity</h3>
          <div className="table-container">
            <table>
              <thead><tr><th>ID</th><th>Type</th><th>Amount</th><th>Time</th><th>Status</th></tr></thead>
              <tbody>
                {loans.map((tx, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ fontSize: '0.75rem' }}>{tx.hash ? <a href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-glow)' }}>{tx.id}</a> : tx.id}</td>
                    <td>{tx.type}</td>
                    <td style={{ fontWeight: 600 }}>{tx.amount} {tx.asset}</td>
                    <td>{new Date(tx.time).toLocaleDateString()}</td>
                    <td><span className={`badge ${tx.status === 'Completed' || tx.status === 'Active' ? 'success' : 'warning'}`}>{tx.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </motion.div>
  );
}

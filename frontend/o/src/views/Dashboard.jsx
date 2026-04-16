import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWalletStore } from '../store/wallet';
import { useAnalytics } from '../store/analytics';
import { useLendingStore } from '../store/lending';
import { motion } from 'framer-motion';
import { Send, Lock, TrendingUp, CheckCircle2, AlertCircle, Activity, ArrowRight, RefreshCw } from 'lucide-react';

export default function Dashboard() {
  const { address, balance, sendTransaction, transactions } = useWalletStore();
  const { creditScore, poolBalance } = useLendingStore();
  const { fetchBalances, fetchBackendMetrics, indexFromHorizon, isIndexing } = useAnalytics();
  const navigate = useNavigate();

  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [txHash, setTxHash] = useState(null);
  const [txStatus, setTxStatus] = useState('idle');
  const [txError, setTxError] = useState(null);

  useEffect(() => {
    fetchBalances(); fetchBackendMetrics(); indexFromHorizon();
    const t1 = setInterval(fetchBalances, 30_000);
    const t2 = setInterval(fetchBackendMetrics, 15_000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [fetchBalances, fetchBackendMetrics, indexFromHorizon]);

  const handleSend = async (e) => {
    e.preventDefault();
    setTxStatus('pending'); setTxError(null); setTxHash(null);
    try {
      const res = await sendTransaction(destination, amount);
      setTxHash(res?.hash || res);
      setTxStatus('success');
      setDestination(''); setAmount('');
    } catch (err) {
      setTxStatus('error');
      setTxError(err.message || 'Something went wrong');
    }
  };

  const recentTxs = (transactions || []).slice(0, 5);
  const scoreVal = Math.max(0, Math.min(800, creditScore || 800));
  const band = scoreVal >= 720 ? { label: 'Excellent', color: '#10b981' }
    : scoreVal >= 640 ? { label: 'Good', color: '#34d399' }
    : scoreVal >= 540 ? { label: 'Fair', color: '#f59e0b' }
    : scoreVal >= 400 ? { label: 'Poor', color: '#f97316' }
    : { label: 'Very Poor', color: '#ef4444' };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>

      {/* ── Balance Hero ── */}
      <div style={{ marginBottom: '2.5rem' }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: '0.5rem' }}>
          Your Balance
        </div>
        <div style={{ fontSize: '3rem', fontWeight: 800, color: 'var(--text-main)', lineHeight: 1, marginBottom: '0.35rem' }}>
          {balance ? parseFloat(balance).toFixed(2) : '0.00'}
          <span style={{ fontSize: '1.25rem', color: 'var(--text-muted)', marginLeft: '0.5rem', fontWeight: 500 }}>XLM</span>
        </div>
        <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          Available to send, lock, or earn with
        </div>
      </div>

      {/* ── 3 Primary Actions ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2.5rem' }}>
        {[
          {
            icon: Send, color: '#a855f7',
            title: 'Send Money',
            desc: 'Send XLM to anyone, anywhere. Settles in under 5 seconds.',
            cta: 'Send now',
            path: '/payment-hub',
          },
          {
            icon: Lock, color: '#38bdf8',
            title: 'Lock Funds',
            desc: 'Secure a payment in escrow. Released only when you confirm delivery.',
            cta: 'Create escrow',
            path: '/escrow',
          },
          {
            icon: TrendingUp, color: '#10b981',
            title: 'Earn Yield',
            desc: `Deposit XLM and earn interest. Fixed deposits up to 15% APY.`,
            cta: 'Start earning',
            path: '/lending',
          },
        ].map((a, i) => (
          <button
            key={i}
            onClick={() => navigate(a.path)}
            style={{
              background: '#1e1a2e',
              border: 'none',
              borderRadius: '1rem',
              padding: '1.5rem',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.3)'; }}
          >
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `${a.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
              <a.icon size={18} color={a.color} />
            </div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)', marginBottom: '0.4rem' }}>{a.title}</div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.65, marginBottom: '1rem' }}>{a.desc}</p>
            <div style={{ fontSize: '0.82rem', color: a.color, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              {a.cta} <ArrowRight size={13} />
            </div>
          </button>
        ))}
      </div>

      {/* ── Quick Send + Recent ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: '1.25rem', marginBottom: '2.5rem' }}>

        {/* Quick Send */}
        <div style={{ background: '#1e1a2e', borderRadius: '1rem', padding: '1.75rem', boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }}>
          <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.35rem' }}>Quick Send</div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.65, marginBottom: '1.5rem' }}>
            Send XLM directly to any Stellar wallet address.
          </p>
          <form onSubmit={handleSend} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, display: 'block', marginBottom: '0.5rem' }}>
                Recipient address
              </label>
              <input
                type="text"
                value={destination}
                onChange={e => setDestination(e.target.value)}
                placeholder="G..."
                className="form-input mono"
                required
                style={{ fontSize: '0.875rem' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, display: 'block', marginBottom: '0.5rem' }}>
                Amount
              </label>
              <div className="input-wrapper">
                <input
                  type="number"
                  step="0.0000001"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="form-input large"
                  required
                />
                <div className="input-suffix">XLM</div>
              </div>
            </div>
            <button
              type="submit"
              disabled={txStatus === 'pending' || !destination || !amount}
              className="submit-btn"
              style={{ marginTop: '0.25rem' }}
            >
              {txStatus === 'pending' ? <div className="spinner" /> : <><Send size={15} /> Send Payment</>}
            </button>
          </form>

          {txStatus === 'success' && (
            <div className="tx-status success" style={{ marginTop: '1rem' }}>
              <div className="status-flex"><CheckCircle2 size={15} /> Payment sent</div>
              <a href={`https://stellar.expert/explorer/testnet/tx/${txHash}`} target="_blank" rel="noreferrer" className="status-link">
                View on explorer ↗
              </a>
            </div>
          )}
          {txStatus === 'error' && (
            <div className="tx-status error" style={{ marginTop: '1rem' }}>
              <div className="status-flex start">
                <AlertCircle size={15} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Payment failed</div>
                  <div style={{ fontSize: '0.8rem', opacity: 0.85, marginTop: '0.2rem' }}>{txError}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Recent Payments */}
        <div style={{ background: '#1e1a2e', borderRadius: '1rem', padding: '1.75rem', boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>Recent Payments</div>
            <button
              onClick={() => navigate('/activity')}
              style={{ fontSize: '0.78rem', color: 'var(--accent-glow)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
            >
              View all →
            </button>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.65, marginBottom: '1.25rem' }}>
            Your last 5 transactions from this session.
          </p>

          {recentTxs.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {recentTxs.map((tx, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.875rem 0',
                  borderBottom: i < recentTxs.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 8,
                      background: tx.status === 'Completed' ? 'rgba(16,185,129,0.12)' : tx.status === 'Failed' ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {tx.status === 'Completed'
                        ? <CheckCircle2 size={14} color="#10b981" />
                        : tx.status === 'Failed'
                        ? <AlertCircle size={14} color="#ef4444" />
                        : <Activity size={14} color="#f59e0b" />
                      }
                    </div>
                    <div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>{tx.type || 'Payment'}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {new Date(tx.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>{tx.amount}</div>
                    <div style={{ fontSize: '0.72rem', color: tx.status === 'Completed' ? '#10b981' : tx.status === 'Failed' ? '#ef4444' : '#f59e0b', fontWeight: 600 }}>
                      {tx.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                No payments yet
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.65, marginBottom: '1.25rem' }}>
                Send your first payment using the form on the left, or use the full Payment Hub for split routing.
              </p>
              <button
                onClick={() => navigate('/payment-hub')}
                style={{ fontSize: '0.82rem', color: 'var(--accent-glow)', background: 'none', border: '1px solid rgba(168,85,247,0.25)', borderRadius: '0.5rem', padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: 600 }}
              >
                Go to Payment Hub →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Credit Score + Earn teaser ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>

        {/* Credit score */}
        <div
          style={{ background: '#1e1a2e', borderRadius: '1rem', padding: '1.75rem', boxShadow: '0 2px 12px rgba(0,0,0,0.3)', cursor: 'pointer' }}
          onClick={() => navigate('/credit-score')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.25rem' }}>Your Credit Score</div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.65 }}>
                Affects your borrowing rate. Repay loans on time to improve it.
              </p>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '1rem' }}>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: band.color, lineHeight: 1 }}>{scoreVal}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>/ 800</div>
            </div>
          </div>
          <div style={{ height: '6px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: '0.5rem' }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(scoreVal / 800) * 100}%` }}
              transition={{ duration: 0.8 }}
              style={{ height: '100%', background: band.color, borderRadius: '999px' }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.78rem', padding: '0.2rem 0.65rem', borderRadius: '999px', background: `${band.color}18`, color: band.color, fontWeight: 700 }}>{band.label}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>View breakdown →</span>
          </div>
        </div>

        {/* Earn teaser */}
        <div
          style={{ background: '#1e1a2e', borderRadius: '1rem', padding: '1.75rem', boxShadow: '0 2px 12px rgba(0,0,0,0.3)', cursor: 'pointer' }}
          onClick={() => navigate('/lending')}
        >
          <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.25rem' }}>Earn on your XLM</div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.65, marginBottom: '1.25rem' }}>
            Your XLM is sitting idle. Deposit it into the lending pool and start earning interest today. No lock-up — withdraw anytime.
          </p>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem' }}>
            {[
              { label: 'Variable APY', value: 'Up to 8%', color: '#38bdf8' },
              { label: 'Fixed Deposit', value: 'Up to 15%', color: '#10b981' },
            ].map((r, i) => (
              <div key={i} style={{ flex: 1, background: 'rgba(0,0,0,0.2)', borderRadius: '0.75rem', padding: '0.875rem' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '0.25rem' }}>{r.label}</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: r.color }}>{r.value}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: '0.82rem', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            Start earning <ArrowRight size={13} />
          </div>
        </div>
      </div>

    </motion.div>
  );
}

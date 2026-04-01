import { useState } from 'react';
import { motion } from 'framer-motion';
import { useWalletStore } from '../store/wallet';

export default function Subscriptions() {
  const { createSubscription, processPayment, pauseSubscription, cancelSubscription, resumeSubscription, transactions } = useWalletStore();
  const [isCreating, setIsCreating] = useState(false);
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [interval, setIntervalVal] = useState('2592000');

  const subTxs = transactions.filter(t => t.type === 'Subscribe');

  const handleSubscribe = async (e) => {
    e.preventDefault();
    if (!merchant || !amount) return;
    setIsCreating(true);
    try {
      const hash = await createSubscription(merchant, amount, 'XLM', interval);
      alert(`Subscription created successfully! Hash: ${hash}`);
      setMerchant(''); setAmount('');
    } catch (err) {
      alert(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleProcess = async (txId) => {
    try {
      const hash = await processPayment(txId);
      alert(`Payment processed! Hash: ${hash}`);
    } catch (err) {
      alert(err.message);
    }
  };

  const getIntervalLabel = (seconds) => {
    if (seconds === 86400) return 'Daily';
    if (seconds === 604800) return 'Weekly';
    if (seconds === 2592000) return 'Monthly';
    return `${seconds}s`;
  };

  const isDue = (nextDueDate) => {
    if (!nextDueDate) return false;
    return new Date(nextDueDate).getTime() <= new Date().getTime();
  };

  const formatDueDate = (nextDueDate) => {
    if (!nextDueDate) return 'N/A';
    const d = new Date(nextDueDate);
    const now = new Date();
    if (d.getTime() <= now.getTime()) return 'Due Now';
    const diff = d.getTime() - now.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `in ${days}d ${hours}h`;
    return `in ${hours}h`;
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="view-header">
        <h2 className="view-title">Subscription & Recurring Payments</h2>
        <p className="view-subtitle">Automate billing cycles with on-chain recurring payment streams.</p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <div className="card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Active</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '0.5rem', color: '#10b981' }}>{subTxs.filter(t => t.status === 'Active').length}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Paused</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '0.5rem', color: '#eab308' }}>{subTxs.filter(t => t.status === 'Paused').length}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Total Billed</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '0.5rem' }}>{subTxs.reduce((acc, t) => acc + (t.billingCount || 1), 0)}</div>
        </div>
      </div>

      <div className="grid-2">
        {/* Active Subscriptions Table */}
        <div className="card">
          <h3 className="card-title">Active Subscriptions</h3>
          <div className="table-container" style={{ maxHeight: '450px', overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Amount</th>
                  <th>Cycle</th>
                  <th>Next Due</th>
                  <th>Billed</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {subTxs.length > 0 ? (
                  subTxs.map((tx, i) => (
                    <tr key={i}>
                      <td className="mono" style={{ fontSize: '0.75rem' }}>
                        {tx.hash ? (
                          <a href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`} target="_blank" rel="noreferrer" style={{color: 'inherit'}}>
                            {tx.id}
                          </a>
                        ) : tx.id}
                      </td>
                      <td className="stat-value">{tx.amount}</td>
                      <td style={{ fontSize: '0.8rem' }}>{getIntervalLabel(tx.intervalSeconds)}</td>
                      <td style={{ fontSize: '0.8rem', color: isDue(tx.nextDueDate) ? '#ef4444' : 'var(--text-muted)', fontWeight: isDue(tx.nextDueDate) ? 600 : 400 }}>
                        {tx.status === 'Active' ? formatDueDate(tx.nextDueDate) : '—'}
                      </td>
                      <td style={{ fontSize: '0.8rem' }}>{tx.billingCount || 1}x</td>
                      <td>
                        <span className={`badge ${tx.status === 'Active' ? 'success' : tx.status === 'Paused' ? 'warning' : tx.status === 'Cancelled' ? 'error' : 'info'}`}>
                          {tx.status}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                          {tx.status === 'Active' && (
                            <>
                              {isDue(tx.nextDueDate) && (
                                <button className="action-btn" style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', background: 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.3)', color: '#a855f7' }} onClick={() => handleProcess(tx.id)}>Process Due</button>
                              )}
                              <button className="action-btn" style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem' }} onClick={() => pauseSubscription(tx.id)}>Pause</button>
                              <button className="action-btn" style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }} onClick={() => cancelSubscription(tx.id)}>Cancel</button>
                            </>
                          )}
                          {tx.status === 'Paused' && (
                            <>
                              <button className="action-btn" style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.3)', color: '#10b981' }} onClick={() => resumeSubscription(tx.id)}>Resume</button>
                              <button className="action-btn" style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }} onClick={() => cancelSubscription(tx.id)}>Cancel</button>
                            </>
                          )}
                          {tx.status === 'Cancelled' && (
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Terminated</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No active subscriptions.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Create Subscription */}
        <div className="card">
          <h3 className="card-title">Create Subscription</h3>
          <p style={{ fontSize: '0.875rem', marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
            Set up a recurring payment allowance for a merchant or service provider.
          </p>
          <form onSubmit={handleSubscribe} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="form-group">
              <label className="form-label">Merchant Address</label>
              <input type="text" placeholder="G..." value={merchant} onChange={(e)=>setMerchant(e.target.value)} className="form-input mono" required />
            </div>
            <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label className="form-label">Amount (XLM)</label>
                <input type="number" step="0.01" value={amount} onChange={(e)=>setAmount(e.target.value)} placeholder="0.00" className="form-input" required style={{ marginTop: '0.5rem' }} />
              </div>
              <div>
                <label className="form-label">Billing Interval</label>
                <select className="form-input" style={{ marginTop: '0.5rem' }} value={interval} onChange={(e)=>setIntervalVal(e.target.value)}>
                  <option value="86400">Daily</option>
                  <option value="604800">Weekly</option>
                  <option value="2592000">Monthly</option>
                </select>
              </div>
            </div>
            <button 
              type="submit"
              className="submit-btn" 
              style={{ marginTop: '0.5rem' }}
              disabled={isCreating || !merchant || !amount}
            >
              {isCreating ? 'Subscribing...' : 'Approve Subscription'}
            </button>
          </form>
        </div>
      </div>
    </motion.div>
  );
}

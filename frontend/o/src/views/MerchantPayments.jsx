import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useWalletStore } from '../store/wallet';

export default function MerchantPayments() {
  const { routePayment, transactions, savedRouteTemplates, saveRouteTemplate, deleteRouteTemplate } = useWalletStore();
  
  const [totalAmount, setTotalAmount] = useState('');
  const [splits, setSplits] = useState([{ address: '', percentage: 100 }]);
  const [isRouting, setIsRouting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);

  const routedTxs = transactions.filter(t => t.type === 'Routed Payment');

  // Stats
  const stats = useMemo(() => {
    const totalVolume = routedTxs.reduce((acc, tx) => acc + parseFloat(tx.amount?.split(' ')[0] || 0), 0);
    const avgSplits = routedTxs.length > 0 
      ? (routedTxs.reduce((acc, tx) => {
          const match = tx.recipients?.match(/(\d+) Recipients/);
          return acc + (match ? parseInt(match[1]) : 1);
        }, 0) / routedTxs.length).toFixed(1)
      : '0';
    const successCount = routedTxs.filter(t => t.status === 'Completed').length;
    const successRate = routedTxs.length > 0 ? ((successCount / routedTxs.length) * 100).toFixed(1) : '100.0';
    return { totalVolume: totalVolume.toFixed(2), routesExecuted: routedTxs.length, avgSplits, successRate };
  }, [routedTxs]);

  // Fee estimation: Stellar base fee is 100 stroops per operation
  const estimatedFee = (splits.length * 0.00001).toFixed(5);
  const totalPercent = splits.reduce((acc, curr) => acc + Number(curr.percentage), 0);

  const handleAddSplit = () => setSplits([...splits, { address: '', percentage: 0 }]);
  const handleRemoveSplit = (index) => { const s = [...splits]; s.splice(index, 1); setSplits(s); };
  const handleSplitChange = (index, field, value) => { const s = [...splits]; s[index][field] = value; setSplits(s); };

  const loadTemplate = (template) => {
    setSplits(template.splits.map(s => ({ ...s })));
  };

  const handleSaveTemplate = () => {
    if (!templateName.trim()) return;
    saveRouteTemplate(templateName.trim(), splits);
    setTemplateName('');
    setShowSaveTemplate(false);
  };

  const handleRoute = async () => {
    setShowConfirm(false);
    setIsRouting(true);
    try {
      const hash = await routePayment(totalAmount, splits, 'XLM');
      alert(`Payment routed successfully! Hash: ${hash}`);
      setTotalAmount('');
      setSplits([{ address: '', percentage: 100 }]);
    } catch (err) {
      alert(err.message);
    } finally {
      setIsRouting(false);
    }
  };

  const handleSubmitForm = (e) => {
    e.preventDefault();
    if (!totalAmount || splits.length === 0) return;
    if (totalPercent !== 100) {
      alert(`Percentages must equal exactly 100%. Currently: ${totalPercent}%`);
      return;
    }
    setShowConfirm(true);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="view-header">
        <h2 className="view-title">Payment Router</h2>
        <p className="view-subtitle">Intelligent split-payment routing engine with atomic on-chain settlement.</p>
      </div>

      {/* Stats Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <div className="card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Total Routed</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '0.5rem' }}>{stats.totalVolume} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>XLM</span></div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Routes Executed</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '0.5rem' }}>{stats.routesExecuted}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Avg Recipients</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '0.5rem' }}>{stats.avgSplits}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Success Rate</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '0.5rem', color: '#10b981' }}>{stats.successRate}%</div>
        </div>
      </div>

      {/* Main Router + Templates */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
        <div className="card">
          <h3 className="card-title">Configure Route</h3>
          <form onSubmit={handleSubmitForm} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '1rem', alignItems: 'end' }}>
              <div>
                <label className="form-label">Total Amount (XLM)</label>
                <input type="number" step="0.01" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} placeholder="0.00" className="form-input" required disabled={isRouting} style={{ marginTop: '0.5rem' }} />
              </div>
              <div style={{ padding: '0.75rem 1rem', background: 'rgba(168,85,247,0.05)', borderRadius: '8px', border: '1px solid rgba(168,85,247,0.1)', textAlign: 'center' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Est. Fee</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#a855f7' }}>{estimatedFee} XLM</div>
              </div>
            </div>

            <div style={{ borderBottom: '1px solid var(--glass-border)', paddingBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <label className="form-label" style={{ marginBottom: 0 }}>Split Destinations <span style={{ color: totalPercent === 100 ? '#10b981' : '#ef4444', fontWeight: 600 }}>({totalPercent}%)</span></label>
                <button type="button" onClick={handleAddSplit} className="action-btn" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>+ Add</button>
              </div>
              <div style={{ maxHeight: '250px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                {splits.map((split, index) => (
                  <div key={index} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <input type="text" value={split.address} onChange={(e) => handleSplitChange(index, 'address', e.target.value)} placeholder="G..." className="form-input mono" required disabled={isRouting} />
                    </div>
                    <div style={{ width: '80px', position: 'relative' }}>
                      <input type="number" min="1" max="100" value={split.percentage} onChange={(e) => handleSplitChange(index, 'percentage', e.target.value)} className="form-input" required disabled={isRouting} />
                      <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>%</span>
                    </div>
                    <div style={{ width: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-glow)', fontSize: '0.875rem', fontWeight: 600 }}>
                      {(totalAmount * (split.percentage / 100) || 0).toFixed(2)}
                    </div>
                    {splits.length > 1 && (
                      <button type="button" onClick={() => handleRemoveSplit(index)} className="action-btn" style={{ padding: '0.5rem', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }} disabled={isRouting}>&times;</button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button type="submit" disabled={isRouting || !totalAmount || totalPercent !== 100} className="submit-btn" style={{ flex: 1 }}>
                {isRouting ? 'Routing...' : 'Review & Execute Route'}
              </button>
              {!showSaveTemplate ? (
                <button type="button" onClick={() => setShowSaveTemplate(true)} className="action-btn" style={{ whiteSpace: 'nowrap' }}>Save Template</button>
              ) : (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input type="text" placeholder="Template name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} className="form-input" style={{ width: '150px', padding: '0.5rem' }} />
                  <button type="button" onClick={handleSaveTemplate} className="action-btn primary" style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem' }}>Save</button>
                </div>
              )}
            </div>
          </form>
        </div>

        {/* Templates Panel */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 className="card-title">Saved Templates</h3>
          {savedRouteTemplates && savedRouteTemplates.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1 }}>
              {savedRouteTemplates.map((template, i) => (
                <div key={i} style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.06) 0%, rgba(56,189,248,0.04) 100%)', borderRadius: '12px', padding: '1rem', border: '1px solid rgba(168,85,247,0.12)', transition: 'border-color 0.2s' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(168,85,247,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 700, color: '#a855f7' }}>
                        {template.splits.length}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)' }}>{template.name}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>{template.splits.length} recipients</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button onClick={() => loadTemplate(template)} style={{ padding: '0.35rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(168,85,247,0.25)', background: 'rgba(168,85,247,0.08)', color: '#a855f7', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}>Load</button>
                      <button onClick={() => deleteRouteTemplate(template.name)} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.15)', background: 'transparent', color: '#ef4444', fontSize: '0.75rem', cursor: 'pointer', opacity: 0.7 }}>&times;</button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {template.splits.map((s, j) => (
                      <span key={j} style={{ padding: '0.2rem 0.55rem', borderRadius: '4px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {s.percentage}%
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2.5rem 1.5rem', textAlign: 'center' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'linear-gradient(135deg, rgba(168,85,247,0.1) 0%, rgba(56,189,248,0.08) 100%)', border: '1px solid rgba(168,85,247,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.5rem' }}>No Saved Templates</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.5', maxWidth: '220px' }}>
                Configure a split route and click <span style={{ color: '#a855f7', fontWeight: 500 }}>"Save Template"</span> to reuse it later.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ maxWidth: '500px', width: '90%' }}>
            <h3 className="card-title" style={{ marginBottom: '1rem' }}>Confirm Route Execution</h3>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Total Amount</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{totalAmount} XLM</div>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Recipients ({splits.length})</div>
              {splits.map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--glass-border)', fontSize: '0.85rem' }}>
                  <span className="mono" style={{ fontSize: '0.75rem' }}>{s.address ? `${s.address.slice(0,6)}...${s.address.slice(-6)}` : 'Empty'}</span>
                  <span style={{ fontWeight: 600 }}>{(totalAmount * (s.percentage / 100)).toFixed(4)} XLM ({s.percentage}%)</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              <span>Estimated Network Fee</span>
              <span style={{ color: '#a855f7' }}>{estimatedFee} XLM</span>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button onClick={() => setShowConfirm(false)} className="action-btn" style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
              <button onClick={handleRoute} className="submit-btn" style={{ flex: 1 }}>Confirm & Sign</button>
            </div>
          </div>
        </div>
      )}

      {/* Routing History */}
      <div className="card">
        <h3 className="card-title">Routing History</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Route ID</th>
                <th>Recipients</th>
                <th>Amount</th>
                <th>Time</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {routedTxs.length > 0 ? (
                routedTxs.map((tx, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ fontSize: '0.75rem' }}>
                      {tx.hash ? (
                        <a href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`} target="_blank" rel="noreferrer" style={{color: 'inherit'}}>
                          {tx.id}
                        </a>
                      ) : tx.id}
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>{tx.recipients}</td>
                    <td className="stat-value">{tx.amount}</td>
                    <td>{new Date(tx.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                    <td>
                      <span className={`badge ${tx.status === 'Completed' ? 'success' : tx.status === 'Failed' ? 'error' : 'warning'}`}>
                        {tx.status}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No routed payments yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}

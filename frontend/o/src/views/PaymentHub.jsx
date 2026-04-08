import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWalletStore } from '../store/wallet';
import { Users, GitBranch } from 'lucide-react';
import { useToast } from '../components/Toast';

// --- Internal: Payment Router Tab ---
function PaymentRouter() {
  const toast = useToast(); const { routePayment, transactions, savedRouteTemplates, saveRouteTemplate, deleteRouteTemplate } = useWalletStore();
  const [totalAmount, setTotalAmount] = useState('');
  const [splits, setSplits] = useState([{ address: '', percentage: 100 }]);
  const [isRouting, setIsRouting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);

  const routedTxs = transactions.filter(t => t.type === 'Routed Payment');
  const stats = useMemo(() => {
    const totalVolume = routedTxs.reduce((acc, tx) => acc + parseFloat(tx.amount?.split(' ')[0] || 0), 0);
    const successCount = routedTxs.filter(t => t.status === 'Completed').length;
    const successRate = routedTxs.length > 0 ? ((successCount / routedTxs.length) * 100).toFixed(1) : '100.0';
    return { totalVolume: totalVolume.toFixed(2), routesExecuted: routedTxs.length, successRate };
  }, [routedTxs]);

  const estimatedFee = (splits.length * 0.00001).toFixed(5);
  const totalPercent = splits.reduce((acc, curr) => acc + Number(curr.percentage), 0);
  const handleAddSplit = () => setSplits([...splits, { address: '', percentage: 0 }]);
  const handleRemoveSplit = (index) => { const s = [...splits]; s.splice(index, 1); setSplits(s); };
  const handleSplitChange = (index, field, value) => { const s = [...splits]; s[index][field] = value; setSplits(s); };
  const loadTemplate = (template) => setSplits(template.splits.map(s => ({ ...s })));
  const handleSaveTemplate = () => {
    if (!templateName.trim()) return;
    saveRouteTemplate(templateName.trim(), splits);
    setTemplateName(''); setShowSaveTemplate(false);
  };
  const handleRoute = async () => {
    setShowConfirm(false); setIsRouting(true);
    try {
      const hash = await routePayment(totalAmount, splits, 'XLM');
      console.warn(`Payment routed successfully!\nHash: ${hash}`);
      setTotalAmount(''); setSplits([{ address: '', percentage: 100 }]);
    } catch (err) { toast.error(err.message); }
    finally { setIsRouting(false); }
  };
  const handleSubmitForm = (e) => {
    e.preventDefault();
    if (totalPercent !== 100) { console.warn(`Percentages must equal 100%. Currently: ${totalPercent}%`); return; }
    setShowConfirm(true);
  };

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        {[
          { label: 'Total Routed', value: `${stats.totalVolume} XLM` },
          { label: 'Routes Executed', value: stats.routesExecuted },
          { label: 'Success Rate', value: `${stats.successRate}%`, color: '#10b981' },
        ].map((s, i) => (
          <div key={i} className="card">
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, marginTop: '0.5rem', color: s.color || 'var(--text-main)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '2rem', marginBottom: '2rem' }} className="payment-router-grid">
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
              <div style={{ maxHeight: '220px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                {splits.map((split, index) => (
                  <div key={index} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', alignItems: 'center' }} className="split-row">
                    <input type="text" value={split.address} onChange={(e) => handleSplitChange(index, 'address', e.target.value)} placeholder="G..." className="form-input mono" required disabled={isRouting} style={{ flex: 1 }} />
                    <div style={{ width: '80px', position: 'relative' }}>
                      <input type="number" min="1" max="100" value={split.percentage} onChange={(e) => handleSplitChange(index, 'percentage', e.target.value)} className="form-input" required disabled={isRouting} />
                      <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>%</span>
                    </div>
                    <div style={{ width: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-glow)', fontSize: '0.875rem', fontWeight: 600 }}>
                      {(totalAmount * (split.percentage / 100) || 0).toFixed(2)}
                    </div>
                    {splits.length > 1 && <button type="button" onClick={() => handleRemoveSplit(index)} className="action-btn" style={{ padding: '0.5rem', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }} disabled={isRouting}>&times;</button>}
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
                  <input type="text" placeholder="Template name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} className="form-input" style={{ width: '140px', padding: '0.5rem' }} />
                  <button type="button" onClick={handleSaveTemplate} className="action-btn" style={{ padding: '0.5rem 0.75rem' }}>Save</button>
                </div>
              )}
            </div>
          </form>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 className="card-title">Saved Templates</h3>
          {savedRouteTemplates && savedRouteTemplates.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {savedRouteTemplates.map((template, i) => (
                <div key={i} style={{ background: 'rgba(168,85,247,0.05)', borderRadius: '10px', padding: '0.9rem', border: '1px solid rgba(168,85,247,0.1)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{template.name}</div>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button onClick={() => loadTemplate(template)} style={{ padding: '0.3rem 0.65rem', borderRadius: '6px', border: '1px solid rgba(168,85,247,0.25)', background: 'rgba(168,85,247,0.08)', color: '#a855f7', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}>Load</button>
                      <button onClick={() => deleteRouteTemplate(template.name)} style={{ padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.15)', background: 'transparent', color: '#ef4444', fontSize: '0.72rem', cursor: 'pointer' }}>&times;</button>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{template.splits.length} recipients · {template.splits.map(s => `${s.percentage}%`).join(', ')}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '2rem 1rem' }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No saved templates yet. Configure a route and click <span style={{ color: '#a855f7' }}>Save Template</span>.</div>
            </div>
          )}
        </div>
      </div>

      {/* Routing History */}
      <div className="card">
        <h3 className="card-title">Routing History</h3>
        <div className="table-container">
          <table><thead><tr><th>Route ID</th><th>Recipients</th><th>Amount</th><th>Time</th><th>Status</th></tr></thead>
            <tbody>
              {routedTxs.length > 0 ? routedTxs.map((tx, i) => (
                <tr key={i}>
                  <td className="mono" style={{ fontSize: '0.75rem' }}>{tx.hash ? <a href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{tx.id}</a> : tx.id}</td>
                  <td style={{ fontSize: '0.85rem' }}>{tx.recipients}</td>
                  <td className="stat-value">{tx.amount}</td>
                  <td>{new Date(tx.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  <td><span className={`badge ${tx.status === 'Completed' ? 'success' : 'error'}`}>{tx.status}</span></td>
                </tr>
              )) : <tr><td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No routed payments yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ maxWidth: '480px', width: '90%' }}>
            <h3 className="card-title" style={{ marginBottom: '1rem' }}>Confirm Route Execution</h3>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Total Amount</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{totalAmount} XLM</div>
            </div>
            {splits.map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--glass-border)', fontSize: '0.85rem' }}>
                <span className="mono" style={{ fontSize: '0.75rem' }}>{s.address ? `${s.address.slice(0,6)}...${s.address.slice(-6)}` : 'Empty'}</span>
                <span style={{ fontWeight: 600 }}>{(totalAmount * (s.percentage / 100)).toFixed(4)} XLM ({s.percentage}%)</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              <span>Est. Fee</span><span style={{ color: '#a855f7' }}>{estimatedFee} XLM</span>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button onClick={() => setShowConfirm(false)} className="action-btn" style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
              <button onClick={handleRoute} className="submit-btn" style={{ flex: 1 }}>Confirm & Sign</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Internal: Bulk Payouts Tab ---
function BulkPayoutsTab() {
  const { batchPayment, transactions, balance } = useWalletStore();
  const [recipients, setRecipients] = useState([{ address: '', amount: '' }]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const bulkTxs = transactions.filter(t => t.type === 'Bulk Payout');
  const handleAddRecipient = () => setRecipients([...recipients, { address: '', amount: '' }]);
  const handleRemoveRecipient = (index) => { const r = [...recipients]; r.splice(index, 1); setRecipients(r); };
  const handleRecipientChange = (index, field, value) => { const r = [...recipients]; r[index][field] = value; setRecipients(r); };
  const totalAmount = recipients.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
  const validCount = recipients.filter(r => r.address && r.amount && parseFloat(r.amount) > 0).length;
  const exceedsBalance = balance && totalAmount > parseFloat(balance);

  const handleCSVImport = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const lines = event.target.result.split('\n').filter(l => l.trim());
      const parsed = lines.map(line => { const p = line.split(',').map(x => x.trim()); return { address: p[0] || '', amount: p[1] || '' }; }).filter(p => p.address && p.amount);
      if (parsed.length > 0) setRecipients(parsed);
      else toast.warning('Invalid CSV. Expected: address,amount (one per line)');
    };
    reader.readAsText(file); e.target.value = '';
  };

  const handleExecuteBulk = async () => {
    setShowConfirm(false);
    const valid = recipients.filter(r => r.address && r.amount && parseFloat(r.amount) > 0);
    if (valid.length === 0) { toast.warning('Add at least one valid recipient.'); return; }
    setIsProcessing(true);
    try {
      const hash = await batchPayment(valid, 'XLM');
      console.warn(`Bulk Payout processed!\nHash: ${hash}`);
      setRecipients([{ address: '', amount: '' }]);
    } catch (err) { toast.error(err.message); }
    finally { setIsProcessing(false); }
  };

  const handleSubmitForm = (e) => {
    e.preventDefault();
    if (validCount === 0) { toast.warning('Add at least one valid recipient.'); return; }
    if (exceedsBalance) { console.warn(`Total exceeds your balance.`); return; }
    setShowConfirm(true);
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        {[
          { label: 'Batches Executed', value: bulkTxs.length },
          { label: 'Total Disbursed', value: `${bulkTxs.reduce((acc, tx) => acc + parseFloat(tx.amount?.split(' ')[0] || 0), 0).toFixed(2)} XLM` },
          { label: 'Available Balance', value: balance ? `${parseFloat(balance).toFixed(2)} XLM` : '---', color: exceedsBalance ? '#ef4444' : '#10b981' },
        ].map((s, i) => (
          <div key={i} className="card">
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, marginTop: '0.5rem', color: s.color || 'var(--text-main)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
            <h3 className="card-title" style={{ marginBottom: 0 }}>Configure Bulk Transfer</h3>
            <div style={{ color: exceedsBalance ? '#ef4444' : 'var(--accent-glow)', fontWeight: 600 }}>Total: {totalAmount.toFixed(2)} XLM</div>
          </div>
          <form onSubmit={handleSubmitForm} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ borderBottom: '1px solid var(--glass-border)', paddingBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <label className="form-label" style={{ marginBottom: 0 }}>Recipients ({validCount})</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <label className="action-btn" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', cursor: 'pointer' }}>
                    Import CSV <input type="file" accept=".csv,.txt" onChange={handleCSVImport} style={{ display: 'none' }} />
                  </label>
                  <button type="button" onClick={handleAddRecipient} className="action-btn" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Users size={14} /> + Add
                  </button>
                </div>
              </div>
              <div style={{ maxHeight: '280px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                {recipients.map((recipient, index) => (
                  <div key={index} style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem', alignItems: 'center' }}>
                    <input type="text" value={recipient.address} onChange={(e) => handleRecipientChange(index, 'address', e.target.value)} placeholder="G..." className="form-input mono" style={{ flex: 1 }} disabled={isProcessing} />
                    <div style={{ width: '120px', position: 'relative' }}>
                      <input type="number" step="0.01" min="0.01" value={recipient.amount} onChange={(e) => handleRecipientChange(index, 'amount', e.target.value)} placeholder="0.00" className="form-input" disabled={isProcessing} style={{ paddingRight: '2.5rem' }} />
                      <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>XLM</span>
                    </div>
                    {recipients.length > 1 ? <button type="button" onClick={() => handleRemoveRecipient(index)} className="action-btn" style={{ padding: '0.5rem', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }} disabled={isProcessing}>&times;</button> : <div style={{ width: '38px' }} />}
                  </div>
                ))}
              </div>
            </div>
            {exceedsBalance && (
              <div style={{ padding: '0.75rem', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.2)', fontSize: '0.85rem', color: '#ef4444' }}>
                ⚠ Total ({totalAmount.toFixed(2)} XLM) exceeds balance ({parseFloat(balance).toFixed(2)} XLM)
              </div>
            )}
            <button type="submit" disabled={isProcessing || totalAmount <= 0 || exceedsBalance} className="submit-btn">
              {isProcessing ? 'Processing...' : `Review & Execute Payout (${validCount} recipients)`}
            </button>
          </form>
        </div>

        <div className="card">
          <h3 className="card-title">Recent Bulk Payouts</h3>
          <div className="table-container" style={{ maxHeight: '420px', overflowY: 'auto' }}>
            <table><thead><tr><th>Recipients</th><th>Total</th><th>Time</th><th>Status</th></tr></thead>
              <tbody>
                {bulkTxs.length > 0 ? bulkTxs.map((tx, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ fontSize: '0.75rem', color: 'var(--accent-glow)' }}>
                      {tx.hash ? <a href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{tx.recipients}</a> : tx.recipients}
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>{tx.amount}</td>
                    <td>{new Date(tx.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    <td><span className={`badge ${tx.status === 'Completed' ? 'success' : 'error'}`}>{tx.status}</span></td>
                  </tr>
                )) : <tr><td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No batch transfers yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ maxWidth: '480px', width: '90%' }}>
            <h3 className="card-title" style={{ marginBottom: '1rem' }}>Confirm Bulk Payout</h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}><span style={{ color: 'var(--text-muted)' }}>Recipients</span><span style={{ fontWeight: 600 }}>{validCount}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}><span style={{ color: 'var(--text-muted)' }}>Total Amount</span><span style={{ fontWeight: 600 }}>{totalAmount.toFixed(4)} XLM</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}><span style={{ color: 'var(--text-muted)' }}>Est. Network Fee</span><span style={{ color: '#a855f7' }}>{(validCount * 0.00001).toFixed(5)} XLM</span></div>
            <div style={{ maxHeight: '180px', overflowY: 'auto', marginBottom: '1rem', padding: '0.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
              {recipients.filter(r => r.address && r.amount).map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid var(--glass-border)', fontSize: '0.8rem' }}>
                  <span className="mono" style={{ fontSize: '0.7rem' }}>{r.address.slice(0, 6)}...{r.address.slice(-6)}</span>
                  <span style={{ fontWeight: 600 }}>{parseFloat(r.amount).toFixed(4)} XLM</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={() => setShowConfirm(false)} className="action-btn" style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
              <button onClick={handleExecuteBulk} className="submit-btn" style={{ flex: 1 }}>Confirm & Sign</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Parent: Payment Hub ---
export default function PaymentHub() {
  const [activeTab, setActiveTab] = useState('router');

  const tabs = [
    { id: 'router', label: 'Payment Router', icon: GitBranch, desc: 'Split-payment routing with atomic settlement' },
    { id: 'bulk', label: 'Bulk Payouts', icon: Users, desc: 'Mass-disbursement & enterprise payroll' },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="view-header">
        <h2 className="view-title">Payment Hub</h2>
        <p className="view-subtitle">Unified payment execution engine — from single atomic routes to bulk enterprise disbursements.</p>
      </div>

      {/* Tab Switcher */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '2rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', borderRadius: '12px', padding: '0.4rem' }}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', gap: '0.65rem',
                padding: '0.75rem 1.25rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
                background: isActive ? 'rgba(56,189,248,0.1)' : 'transparent',
                color: isActive ? 'var(--accent-glow)' : 'var(--text-muted)',
                transition: 'all 0.2s ease',
                borderBottom: isActive ? '2px solid var(--accent-glow)' : '2px solid transparent',
              }}
            >
              <Icon size={16} />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{tab.label}</div>
                <div style={{ fontSize: '0.7rem', opacity: 0.7, marginTop: '1px' }}>{tab.desc}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.15 }}
        >
          {activeTab === 'router' ? <PaymentRouter /> : <BulkPayoutsTab />}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}



import { useState } from 'react';
import { motion } from 'framer-motion';
import { useWalletStore } from '../store/wallet';
import { Users } from 'lucide-react';

export default function BulkPayouts() {
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
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split('\n').filter(l => l.trim());
      const parsed = lines.map(line => {
        const parts = line.split(',').map(p => p.trim());
        return { address: parts[0] || '', amount: parts[1] || '' };
      }).filter(p => p.address && p.amount);
      if (parsed.length > 0) {
        setRecipients(parsed);
      } else {
        alert('Invalid CSV format. Expected: address,amount (one per line)');
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset file input
  };

  const handleExecuteBulk = async () => {
    setShowConfirm(false);
    const validRecipients = recipients.filter(r => r.address && r.amount && parseFloat(r.amount) > 0);
    if (validRecipients.length === 0) {
      alert("Please add at least one valid recipient and amount.");
      return;
    }
    setIsProcessing(true);
    try {
      const hash = await batchPayment(validRecipients, 'XLM');
      alert(`Bulk Payout processed! Hash: ${hash}`);
      setRecipients([{ address: '', amount: '' }]);
    } catch (err) {
      alert(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmitForm = (e) => {
    e.preventDefault();
    if (validCount === 0) { alert('Add at least one valid recipient.'); return; }
    if (exceedsBalance) { alert(`Total (${totalAmount.toFixed(2)} XLM) exceeds your balance (${parseFloat(balance).toFixed(2)} XLM).`); return; }
    setShowConfirm(true);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="view-header">
        <h2 className="view-title">Bulk Payouts</h2>
        <p className="view-subtitle">Enterprise payroll and mass-disbursement engine. All payments settle atomically in a single ledger entry.</p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <div className="card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Batches Executed</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '0.5rem' }}>{bulkTxs.length}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Total Disbursed</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '0.5rem' }}>
            {bulkTxs.reduce((acc, tx) => acc + parseFloat(tx.amount?.split(' ')[0] || 0), 0).toFixed(2)} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>XLM</span>
          </div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Available Balance</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '0.5rem', color: exceedsBalance ? '#ef4444' : '#10b981' }}>
            {balance ? parseFloat(balance).toFixed(2) : '---'} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>XLM</span>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
            <h3 className="card-title" style={{ marginBottom: 0 }}>Configure Bulk Transfer</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ color: exceedsBalance ? '#ef4444' : 'var(--accent-glow)', fontWeight: '600', fontSize: '1.1rem' }}>
                Total: {totalAmount.toFixed(2)} XLM
              </div>
            </div>
          </div>
          
          <form onSubmit={handleSubmitForm} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ borderBottom: '1px solid var(--glass-border)', paddingBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <label className="form-label" style={{ marginBottom: 0 }}>Recipients ({validCount})</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <label className="action-btn" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', cursor: 'pointer' }}>
                    Import CSV
                    <input type="file" accept=".csv,.txt" onChange={handleCSVImport} style={{ display: 'none' }} />
                  </label>
                  <button type="button" onClick={handleAddRecipient} className="action-btn" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Users size={14} /> + Add
                  </button>
                </div>
              </div>
              
              <div style={{ maxHeight: '300px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                {recipients.map((recipient, index) => (
                  <div key={index} style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <input type="text" value={recipient.address} onChange={(e) => handleRecipientChange(index, 'address', e.target.value)} placeholder="Recipient G..." className="form-input mono" required disabled={isProcessing} />
                    </div>
                    <div style={{ width: '120px', position: 'relative' }}>
                      <input type="number" step="0.01" min="0.01" value={recipient.amount} onChange={(e) => handleRecipientChange(index, 'amount', e.target.value)} placeholder="0.00" className="form-input" required disabled={isProcessing} style={{ paddingRight: '2.5rem' }} />
                      <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>XLM</span>
                    </div>
                    {recipients.length > 1 ? (
                      <button type="button" onClick={() => handleRemoveRecipient(index)} className="action-btn" style={{ padding: '0.5rem', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }} disabled={isProcessing}>&times;</button>
                    ) : (
                      <div style={{ width: '38px' }}></div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {exceedsBalance && (
              <div style={{ padding: '0.75rem', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.2)', fontSize: '0.85rem', color: '#ef4444', fontWeight: 500 }}>
                ⚠ Total ({totalAmount.toFixed(2)} XLM) exceeds available balance ({parseFloat(balance).toFixed(2)} XLM)
              </div>
            )}

            <button type="submit" disabled={isProcessing || totalAmount <= 0 || exceedsBalance} className="submit-btn">
              {isProcessing ? 'Processing Batch...' : `Review & Execute Payout (${validCount} recipients)`}
            </button>
          </form>
        </div>

        <div className="card">
          <h3 className="card-title">Recent Bulk Payouts</h3>
          <div className="table-container" style={{ maxHeight: '450px', overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Recipients</th>
                  <th>Total Spent</th>
                  <th>Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {bulkTxs.length > 0 ? (
                  bulkTxs.map((tx, i) => (
                    <tr key={i}>
                      <td className="mono" style={{ fontSize: '0.75rem', color: 'var(--accent-glow)' }}>
                        {tx.hash ? (
                          <a href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`} target="_blank" rel="noreferrer" style={{color: 'inherit'}}>
                            {tx.recipients}
                          </a>
                        ) : tx.recipients}
                      </td>
                      <td className="stat-value" style={{ color: '#ef4444' }}>-{tx.amount}</td>
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
                    <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No batch transfers yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ maxWidth: '500px', width: '90%' }}>
            <h3 className="card-title" style={{ marginBottom: '1rem' }}>Confirm Bulk Payout</h3>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Recipients</span>
                <span style={{ fontWeight: 600 }}>{validCount}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Total Amount</span>
                <span style={{ fontWeight: 600 }}>{totalAmount.toFixed(4)} XLM</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Est. Network Fee</span>
                <span style={{ color: '#a855f7' }}>{(validCount * 0.00001).toFixed(5)} XLM</span>
              </div>
            </div>
            <div style={{ maxHeight: '200px', overflowY: 'auto', marginBottom: '1rem', padding: '0.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
              {recipients.filter(r => r.address && r.amount).map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid var(--glass-border)', fontSize: '0.8rem' }}>
                  <span className="mono" style={{ fontSize: '0.7rem' }}>{r.address.slice(0,6)}...{r.address.slice(-6)}</span>
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
    </motion.div>
  );
}

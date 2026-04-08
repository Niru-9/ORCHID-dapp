import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useWalletStore } from '../store/wallet';
import { useToast } from '../components/Toast';
import { AlertTriangle, Zap, RefreshCw, ExternalLink } from 'lucide-react';

export default function Liquidation() {
  const { address } = useWalletStore();
  const toast = useToast();
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [liquidatingId, setLiquidatingId] = useState(null);
  const [borrowerInput, setBorrowerInput] = useState('');

  const fetchPosition = async (borrowerAddr) => {
    if (!borrowerAddr || borrowerAddr.length < 10) return;
    setLoading(true);
    try {
      const { getHealthFactor, getCollateral, getLoan } = await import('../store/pool_contract.js');
      const [health, collateral] = await Promise.all([
        getHealthFactor(borrowerAddr),
        getCollateral(borrowerAddr),
      ]);

      const healthFactor = health !== null ? Number(health) / 10000 : null;
      const collateralXlm = collateral !== null ? Number(collateral) / 1e7 : 0;

      if (healthFactor !== null && healthFactor < 1.0 && collateralXlm > 0) {
        // Try to fetch loan 1 (most common case)
        const loan = await getLoan(borrowerAddr, 1);
        if (loan) {
          const principal = Number(loan.principal) / 1e7;
          const debt = principal * 1.05; // approximate with 5% interest
          const bonus = debt * 0.05;
          setPositions(prev => {
            const exists = prev.find(p => p.borrower === borrowerAddr);
            if (exists) return prev.map(p => p.borrower === borrowerAddr ? { ...p, healthFactor, collateralXlm, debt, bonus, loanId: Number(loan.id) } : p);
            return [...prev, { borrower: borrowerAddr, healthFactor, collateralXlm, debt, bonus, loanId: Number(loan.id) }];
          });
          toast.warning(`Position found! Health: ${healthFactor.toFixed(2)} — eligible for liquidation`);
        }
      } else if (healthFactor !== null && healthFactor >= 1.0) {
        toast.info(`Position is healthy (${healthFactor.toFixed(2)}). Cannot liquidate.`);
      } else {
        toast.info('No active position found for this address.');
      }
    } catch (err) {
      toast.error(`Failed to fetch position: ${err.message}`);
    }
    setLoading(false);
  };

  const handleLiquidate = async (position) => {
    if (!address) { toast.error('Connect your wallet first'); return; }
    setLiquidatingId(position.borrower);
    try {
      const { poolLiquidate } = await import('../store/pool_contract.js');
      const result = await poolLiquidate(address, position.borrower, position.loanId);
      toast.txSuccess(
        `Liquidated! You received ${(position.debt + position.bonus).toFixed(2)} XLM collateral (+5% bonus)`,
        result.hash
      );
      setPositions(prev => prev.filter(p => p.borrower !== position.borrower));
    } catch (err) {
      toast.error(`Liquidation failed: ${err.message}`);
    }
    setLiquidatingId(null);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="view-header">
        <div>
          <h2 className="view-title">Liquidation</h2>
          <p className="view-subtitle">Liquidate undercollateralized positions and earn a 5% bonus.</p>
        </div>
      </div>

      {/* How it works */}
      <div className="card" style={{ marginBottom: '2rem', background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.2)' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
          <AlertTriangle size={20} color="#f59e0b" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div style={{ fontWeight: 700, color: '#f59e0b', marginBottom: '0.35rem' }}>How Liquidation Works</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              When a borrower's health factor drops below 1.0 (collateral value × 66% &lt; debt), their position becomes eligible for liquidation.
              You repay their debt and receive their collateral + <strong style={{ color: '#f59e0b' }}>5% bonus</strong>.
              This protects the protocol from bad debt.
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <h3 className="card-title">Check a Position</h3>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
          <input
            type="text"
            value={borrowerInput}
            onChange={e => setBorrowerInput(e.target.value)}
            placeholder="Enter borrower wallet address (G...)"
            className="form-input mono"
            style={{ flex: 1 }}
            onKeyDown={e => e.key === 'Enter' && fetchPosition(borrowerInput.trim())}
          />
          <button
            onClick={() => fetchPosition(borrowerInput.trim())}
            disabled={loading || !borrowerInput}
            className="action-btn"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.25rem' }}
          >
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            {loading ? 'Checking...' : 'Check'}
          </button>
        </div>
      </div>

      {/* Liquidatable positions */}
      {positions.length > 0 ? (
        <div className="card">
          <h3 className="card-title" style={{ marginBottom: '1rem' }}>Liquidatable Positions ({positions.length})</h3>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Borrower</th>
                  <th>Health Factor</th>
                  <th>Collateral</th>
                  <th>Debt</th>
                  <th>Your Bonus</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ fontSize: '0.72rem' }}>
                      <a href={`https://stellar.expert/explorer/testnet/account/${pos.borrower}`} target="_blank" rel="noreferrer"
                        style={{ color: 'var(--accent-glow)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                        {pos.borrower.slice(0, 8)}...{pos.borrower.slice(-6)} <ExternalLink size={10} />
                      </a>
                    </td>
                    <td>
                      <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '1rem' }}>
                        {pos.healthFactor.toFixed(3)}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '4px' }}>/ 1.0</span>
                    </td>
                    <td style={{ fontWeight: 600, color: '#f59e0b' }}>{pos.collateralXlm.toFixed(4)} XLM</td>
                    <td style={{ fontWeight: 600, color: '#ef4444' }}>{pos.debt.toFixed(4)} XLM</td>
                    <td style={{ fontWeight: 700, color: '#10b981' }}>+{pos.bonus.toFixed(4)} XLM</td>
                    <td>
                      <button
                        onClick={() => handleLiquidate(pos)}
                        disabled={liquidatingId === pos.borrower}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.4rem',
                          padding: '0.4rem 0.875rem', borderRadius: '6px', border: 'none',
                          background: liquidatingId === pos.borrower ? 'rgba(239,68,68,0.3)' : '#ef4444',
                          color: '#fff', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700,
                        }}
                      >
                        <Zap size={13} />
                        {liquidatingId === pos.borrower ? 'Processing...' : 'Liquidate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <Zap size={40} color="var(--text-muted)" style={{ margin: '0 auto 1rem' }} />
          <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>No positions loaded</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Enter a borrower address above to check if their position is eligible for liquidation.
          </div>
        </div>
      )}
    </motion.div>
  );
}

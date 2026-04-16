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
          <div className="section-label">Liquidation Engine</div>
          <h2 className="view-title">Liquidation</h2>
          <p className="view-subtitle">
            When a borrower's collateral value falls below their outstanding debt, their position becomes eligible for liquidation. You step in, repay their debt, and receive their collateral plus a 5% bonus — keeping the protocol solvent and earning a reward for doing so.
          </p>
        </div>
      </div>

      {/* How it works strip */}
      <div className="info-strip" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: '2.5rem', borderColor: 'rgba(245,158,11,0.2)' }}>
        <div className="info-strip-item" style={{ background: 'rgba(245,158,11,0.03)' }}>
          <div className="info-strip-title" style={{ color: '#f59e0b' }}>Health Factor Drops Below 1.0</div>
          <p className="info-strip-body">A position becomes liquidatable when the borrower's collateral value × 66% drops below their outstanding debt. The health factor measures this ratio — below 1.0 means the protocol is at risk.</p>
        </div>
        <div className="info-strip-item" style={{ background: 'rgba(245,158,11,0.03)' }}>
          <div className="info-strip-title" style={{ color: '#f59e0b' }}>You Repay the Debt</div>
          <p className="info-strip-body">As a liquidator, you repay the borrower's outstanding loan on their behalf. This is executed atomically via the Orchid Pool smart contract — one transaction, no partial fills.</p>
        </div>
        <div className="info-strip-item" style={{ background: 'rgba(245,158,11,0.03)' }}>
          <div className="info-strip-title" style={{ color: '#f59e0b' }}>You Earn a 5% Bonus</div>
          <p className="info-strip-body">In return, you receive the borrower's full collateral plus a 5% liquidation bonus. This is your profit for keeping the protocol free of bad debt. The more positions you liquidate, the more you earn.</p>
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
        <div className="card">
          <div className="empty-state">
            <Zap size={40} color="var(--text-muted)" />
            <div className="empty-state-title">No positions loaded</div>
            <div className="empty-state-desc">Enter a borrower wallet address above to check if their position is eligible for liquidation. Positions with a health factor below 1.0 can be liquidated.</div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

import { NavLink } from 'react-router-dom';
import { useWalletStore } from '../store/wallet';
import {
  ShieldCheck, Landmark,
  Zap, BarChart2, Hexagon, X, LogOut,
  Activity, Globe, PlaneTakeoff,
} from 'lucide-react';

export default function Sidebar({ onClose }) {
  const { address, balance, disconnect } = useWalletStore();

  const navItems = [
    { path: '/dashboard',             label: 'Cockpit',            icon: PlaneTakeoff },
    { path: '/payment-hub',           label: 'Payment Hub',        icon: Zap },
    { path: '/escrow',                label: 'Smart Escrow',       icon: ShieldCheck },
    { path: '/lending',               label: 'DeFi Lending',       icon: Landmark },
    { path: '/credit-score',          label: 'Credit Score',       icon: BarChart2 },
    { path: '/network-transactions',  label: 'Live Transactions',  icon: Activity },
    { path: '/network-stats',         label: 'Network Stats',      icon: Globe },
  ];

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;

  return (
    <aside className="sidebar">
      {/* Header */}
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <Hexagon size={18} />
        </div>
        <h1 className="sidebar-title">ORCHID</h1>

        {/* Close button — only visible on mobile */}
        <button
          onClick={onClose}
          className="sidebar-close-btn"
          aria-label="Close menu"
        >
          <X size={20} />
        </button>
      </div>

      {/* Nav */}
      <nav className="nav-menu">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onClose}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <item.icon size={18} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        {address && (
          <div style={{
            padding: '0.75rem 1rem',
            background: 'rgba(168,85,247,0.06)',
            borderRadius: '0.75rem',
            border: '1px solid rgba(168,85,247,0.12)',
          }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
              Connected
            </div>
            <div style={{ fontSize: '0.8rem', fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent-glow)' }}>
              {shortAddress}
            </div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, marginTop: '0.35rem' }}>
              {balance ? `${parseFloat(balance).toFixed(2)} XLM` : '0 XLM'}
            </div>
          </div>
        )}

        <button
          className="nav-item"
          style={{ color: 'var(--error-text)', marginTop: '0.25rem' }}
          onClick={() => { disconnect(); onClose?.(); }}
        >
          <LogOut size={18} />
          Disconnect
        </button>
      </div>
    </aside>
  );
}

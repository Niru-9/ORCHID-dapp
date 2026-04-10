import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useWalletStore } from '../store/wallet';
import {
  LayoutDashboard, ShieldCheck, Landmark,
  Zap, BarChart2, Hexagon, X, LogOut,
  Activity, BarChart, AlertTriangle, Copy, Check, MonitorDot,
} from 'lucide-react';

export default function Sidebar({ onClose }) {
  const { address, balance, disconnect } = useWalletStore();
  const [copied, setCopied] = useState(false);

  const navItems = [
    { path: '/dashboard',    label: 'Dashboard',      icon: LayoutDashboard },
    { path: '/overview',     label: 'Overview',       icon: BarChart },
    { path: '/payment-hub',  label: 'Payment Hub',    icon: Zap },
    { path: '/escrow',       label: 'Smart Escrow',   icon: ShieldCheck },
    { path: '/lending',      label: 'DeFi Lending',   icon: Landmark },
    { path: '/liquidation',  label: 'Liquidation',    icon: AlertTriangle },
    { path: '/credit-score', label: 'Credit Score',   icon: BarChart2 },
    { path: '/activity',     label: 'Activity',       icon: Activity },
    { path: '/monitor',      label: 'System Monitor', icon: MonitorDot },
  ];

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;

  const copyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <aside className="sidebar">
      {/* Header */}
      <div className="sidebar-header">
        <div className="sidebar-logo"><Hexagon size={18} /></div>
        <h1 className="sidebar-title">ORCHID</h1>
        <button onClick={onClose} className="sidebar-close-btn" aria-label="Close menu">
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
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
              Connected
            </div>
            {/* Copyable address */}
            <button
              onClick={copyAddress}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 0, width: '100%',
              }}
              title="Click to copy full address"
            >
              <span style={{ fontSize: '0.8rem', fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent-glow)' }}>
                {shortAddress}
              </span>
              {copied
                ? <Check size={12} color="#10b981" />
                : <Copy size={12} color="var(--text-muted)" />
              }
            </button>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, marginTop: '0.35rem', color: 'var(--text-main)' }}>
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

import { useEffect, useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useWalletStore } from '../store/wallet';
import { useNetworkStats } from '../store/networkStats';
import { Canvas } from '@react-three/fiber';
import { Globe } from '../components/Globe';
import Sidebar from '../components/Sidebar';
import ToastContainer from '../components/Toast';
import { Menu, X } from 'lucide-react';

export default function Layout() {
  const { address, fetchBalance } = useWalletStore();
  const { registerNode, seedLiquidityFromChain, fetchSettlementTime } = useNetworkStats();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!address) return;
    registerNode(address);
    seedLiquidityFromChain();
    fetchBalance();
    fetchSettlementTime();
    const balanceInterval = setInterval(fetchBalance, 30000);
    const settlementInterval = setInterval(fetchSettlementTime, 60000); // 60s — was 10s, caused rate limits
    return () => {
      clearInterval(balanceInterval);
      clearInterval(settlementInterval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  if (!address) return <Navigate to="/" replace />;

  return (
    <div className="app-layout">
      {/* 3D Background */}
      <div className="bg-canvas">
        <Canvas camera={{ position: [0, 0, 8], fov: 45 }}>
          <Globe />
        </Canvas>
      </div>

      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            zIndex: 999, backdropFilter: 'blur(2px)',
          }}
        />
      )}

      {/* Sidebar — slides in on mobile */}
      <div className={`sidebar-wrapper ${sidebarOpen ? 'open' : ''}`}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main Content */}
      <div className="main-view">
        {/* Mobile top bar */}
        <div className="mobile-topbar">
          <button
            className="hamburger-btn"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: '1.1rem', letterSpacing: '0.1em' }}>
            ORCHID
          </span>
          <div style={{ width: 38 }} />
        </div>

        <Outlet />
      </div>
      <ToastContainer />
    </div>
  );
}

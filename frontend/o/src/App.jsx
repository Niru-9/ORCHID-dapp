import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useWalletStore } from './store/wallet';

import Layout from './components/Layout';
import Landing from './views/Landing';
import Dashboard from './views/Dashboard';
import Escrow from './views/Escrow';
import Lending from './views/Lending';
import PaymentHub from './views/PaymentHub';
import CreditScore from './views/CreditScore';
import NetworkTransactions from './views/NetworkTransactions';
import NetworkStats from './views/NetworkStats';

export default function App() {
  const { address } = useWalletStore();

  return (
    <BrowserRouter>
      <Routes>
        {/* Public Route */}
        <Route
          path="/"
          element={
            address ? <Navigate to="/dashboard" replace /> : (
              <div className="login-container">
                <Landing />
              </div>
            )
          }
        />

        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/escrow" element={<Escrow />} />
          <Route path="/lending" element={<Lending />} />

          {/* Unified Payment Hub (replaces separate routes) */}
          <Route path="/payment-hub" element={<PaymentHub />} />

          {/* Legacy redirects — old bookmarks still work */}
          <Route path="/merchant-payments" element={<Navigate to="/payment-hub" replace />} />
          <Route path="/bulk-payouts" element={<Navigate to="/payment-hub" replace />} />

          {/* Credit Score */}
          <Route path="/credit-score" element={<CreditScore />} />

          {/* Network */}
          <Route path="/network-transactions" element={<NetworkTransactions />} />
          <Route path="/network-stats" element={<NetworkStats />} />
        </Route>

        {/* Fallback Route */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

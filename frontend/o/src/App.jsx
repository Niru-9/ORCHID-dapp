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
import Portfolio from './views/Portfolio';
import Liquidation from './views/Liquidation';
import TransactionHistory from './views/TransactionHistory';

export default function App() {
  const { address } = useWalletStore();

  return (
    <BrowserRouter>
      <Routes>
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
          <Route path="/dashboard"            element={<Dashboard />} />
          <Route path="/portfolio"            element={<Portfolio />} />
          <Route path="/payment-hub"          element={<PaymentHub />} />
          <Route path="/escrow"               element={<Escrow />} />
          <Route path="/lending"              element={<Lending />} />
          <Route path="/liquidation"          element={<Liquidation />} />
          <Route path="/credit-score"         element={<CreditScore />} />
          <Route path="/network-transactions" element={<NetworkTransactions />} />
          <Route path="/network-stats"        element={<NetworkStats />} />
          <Route path="/history"              element={<TransactionHistory />} />

          {/* Legacy redirects */}
          <Route path="/merchant-payments" element={<Navigate to="/payment-hub" replace />} />
          <Route path="/bulk-payouts"      element={<Navigate to="/payment-hub" replace />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

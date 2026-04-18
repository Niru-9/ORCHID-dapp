import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from './App';

// Mock the 3D Canvas and Globe to avoid WebGL issues in jsdom
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }) => <div>{children}</div>,
}));

vi.mock('./components/Globe', () => ({
  Globe: () => <div data-testid="mock-globe" />,
}));

// Mock the zustand stores
vi.mock('./store/wallet', () => ({
  useWalletStore: () => ({
    address: null,
    balance: null,
    isConnecting: false,
    error: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendTransaction: vi.fn(),
    resetConnection: vi.fn(),
  }),
}));

vi.mock('./store/analytics', () => ({
  useAnalytics: () => ({
    totalVolume: 0,
    successCount: 0,
    failCount: 0,
    nodeCount: 0,
    backendAccuracy: null,
    fetchBalances: vi.fn(),
    fetchBackendMetrics: vi.fn(),
    fetchSettlementTime: vi.fn(),
  }),
}));

vi.mock('./store/networkStats', () => ({
  useNetworkStats: () => ({
    knownAddresses: [],
    nodeCount: 0,
    settlementTime: null,
    networkColor: '#10b981',
    fetchSettlementTime: vi.fn(),
  }),
}));

describe('App Component', () => {
  it('renders the ORCHID brand name', () => {
    render(<App />);
    expect(screen.getAllByText(/ORCHID/i).length).toBeGreaterThan(0);
  });

  it('renders the Send Money CTA button', () => {
    render(<App />);
    const button = screen.getByRole('button', { name: /Send Money/i });
    expect(button).toBeInTheDocument();
  });

  it('renders the 3D globe mock', () => {
    render(<App />);
    expect(screen.getByTestId('mock-globe')).toBeInTheDocument();
  });
});

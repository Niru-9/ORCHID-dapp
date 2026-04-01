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

// Mock the zustand store
vi.mock('./store/wallet', () => ({
  useWalletStore: () => ({
    address: null,
    balance: null,
    isConnecting: false,
    error: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendTransaction: vi.fn(),
  }),
}));

describe('App Component', () => {
  it('renders the main heading', () => {
    render(<App />);
    expect(screen.getByText(/ORCHID/i)).toBeInTheDocument();
    expect(screen.getByText(/Intelligent Disbursements/i)).toBeInTheDocument();
  });

  it('renders the connect wallet button', () => {
    render(<App />);
    const button = screen.getByRole('button', { name: /Connect Wallet/i });
    expect(button).toBeInTheDocument();
  });

  it('renders the 3D globe mock', () => {
    render(<App />);
    expect(screen.getByTestId('mock-globe')).toBeInTheDocument();
  });
});

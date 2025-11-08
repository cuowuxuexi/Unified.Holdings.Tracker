import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TransactionList from '../TransactionList';
import useAppStore from '../../store'; // Default import
import { Transaction, TransactionType } from '../../store/types';

// Mock the Zustand store
vi.mock('../../store', () => ({
  default: vi.fn(), // Mock the default export
}));

const mockDeleteTransaction = vi.fn();
const mockPortfolioId = 'portfolio-123';

const mockTransactions: Transaction[] = [
  {
    id: 'txn-1',
    portfolioId: mockPortfolioId,
    date: '2024-01-15T10:00:00Z',
    type: TransactionType.BUY,
    assetCode: 'AAPL',
    asset: {
      code: 'AAPL',
      name: 'Apple Inc'
    },
    price: 150,
    amount: 1500,
    fee: 5,
    currency: 'USD',
    exchangeRate: 1,
  },
  {
    id: 'txn-2',
    portfolioId: mockPortfolioId,
    date: '2024-01-20T11:30:00Z',
    type: TransactionType.SELL,
    assetCode: 'MSFT',
    asset: {
      code: 'MSFT',
      name: 'Microsoft Corporation'
    },
    price: 300,
    amount: 1500,
    fee: 7.5,
    currency: 'USD',
    exchangeRate: 1,
  },
  {
    id: 'txn-3',
    portfolioId: mockPortfolioId,
    date: '2024-02-01T09:00:00Z',
    type: TransactionType.DEPOSIT,
    assetCode: 'USD',
    price: 1,
    amount: 5000,
    fee: 0,
    currency: 'USD',
    exchangeRate: 1,
  },
];

describe('TransactionList Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup mock return value for the store hook
    (useAppStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      // Only mock the actions/state needed by TransactionList or its interaction tests
      deleteTransaction: mockDeleteTransaction,
      // Add other state if TransactionList directly uses it
    });
  });

  it('should render the list/table with transaction data', () => {
    render(<TransactionList transactions={mockTransactions} portfolioId={mockPortfolioId} assetQuoteMap={{}} />);

    // Check for table/list container
    const list = screen.getByRole('list'); // Ant Design List renders as role="list"
    expect(list).toBeInTheDocument();

    // Check for headers (assuming Ant Design List with header prop or similar structure)
    // Or check for specific data points within list items
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Asset')).toBeInTheDocument();
    expect(screen.getByText('Qty')).toBeInTheDocument();
    expect(screen.getByText('Price')).toBeInTheDocument();
    expect(screen.getByText('Amount')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument(); // Assuming an Actions column

    // Check for specific transaction data within list items
    const firstItem = screen.getByText('txn-1').closest('.ant-list-item')!; // Add non-null assertion
    expect(within(firstItem as HTMLElement).getByText('BUY')).toBeInTheDocument(); // Cast to HTMLElement
    expect(within(firstItem as HTMLElement).getByText('AAPL')).toBeInTheDocument(); // Cast to HTMLElement
    expect(within(firstItem as HTMLElement).getByText('10')).toBeInTheDocument(); // Quantity - Cast to HTMLElement
    expect(within(firstItem as HTMLElement).getByText('150')).toBeInTheDocument(); // Price - Cast to HTMLElement
    expect(within(firstItem as HTMLElement).getByText('1500')).toBeInTheDocument(); // Amount - Cast to HTMLElement

    const thirdItem = screen.getByText('txn-3').closest('.ant-list-item')!; // Add non-null assertion
    expect(within(thirdItem as HTMLElement).getByText('DEPOSIT')).toBeInTheDocument(); // Cast to HTMLElement
    expect(within(thirdItem as HTMLElement).getByText('5000')).toBeInTheDocument(); // Amount for deposit - Cast to HTMLElement
    // Check that asset/qty/price might be empty or N/A for deposit
    expect(within(thirdItem as HTMLElement).queryByText('AAPL')).not.toBeInTheDocument(); // Cast to HTMLElement

  });

  it('should call deleteTransaction with correct IDs when delete button is clicked', () => {
    render(<TransactionList transactions={mockTransactions} portfolioId={mockPortfolioId} assetQuoteMap={{}} />);

    // Find the delete button for the first transaction (txn-1)
    // This selector depends heavily on how the button is implemented (e.g., aria-label, specific icon)
    const firstItem = screen.getByText('txn-1').closest('.ant-list-item')!; // Add non-null assertion
    const deleteButton = within(firstItem as HTMLElement).getByRole('button', { name: /delete/i }); // Adjust selector - Cast to HTMLElement

    // Click the delete button
    fireEvent.click(deleteButton);

    // Check if the deleteTransaction action was called
    expect(mockDeleteTransaction).toHaveBeenCalledTimes(1);
    expect(mockDeleteTransaction).toHaveBeenCalledWith(mockPortfolioId, 'txn-1');
  });

  it('should render an empty state message when no transactions are provided', () => {
    render(<TransactionList transactions={[]} portfolioId={mockPortfolioId} assetQuoteMap={{}} />);

    // Check for Ant Design's default empty description or a custom message
    expect(screen.getByText(/no transactions found/i)).toBeInTheDocument(); // Adjust text based on implementation
  });
});
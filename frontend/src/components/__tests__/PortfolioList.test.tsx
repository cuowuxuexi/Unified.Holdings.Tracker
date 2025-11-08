import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PortfolioList from '../PortfolioList';
import useAppStore from '../../store'; // Adjust path if needed

// Mock the Zustand store
vi.mock('../../store', () => ({
  useAppStore: vi.fn(),
}));

const mockSelectPortfolio = vi.fn();
const mockPortfolios = [
  { id: '1', name: 'Tech Stocks', currency: 'USD' },
  { id: '2', name: 'Crypto Fun', currency: 'USD' },
];

describe('PortfolioList Component', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    // Setup mock return value for the store hook
    (useAppStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      portfolios: mockPortfolios,
      selectPortfolio: mockSelectPortfolio,
      selectedPortfolioId: null, // Or set an initial selected ID if needed
    });
  });

  it('should render the list of portfolios', () => {
    render(<PortfolioList />);

    // Check if portfolio names are rendered
    expect(screen.getByText('Tech Stocks')).toBeInTheDocument();
    expect(screen.getByText('Crypto Fun')).toBeInTheDocument();
  });

  it('should call selectPortfolio when a portfolio item is clicked', () => {
    render(<PortfolioList />);

    // Find the first portfolio item (e.g., by its text) and click it
    const firstItem = screen.getByText('Tech Stocks');
    fireEvent.click(firstItem);

    // Check if the selectPortfolio action was called with the correct ID
    expect(mockSelectPortfolio).toHaveBeenCalledTimes(1);
    expect(mockSelectPortfolio).toHaveBeenCalledWith('1');
  });

  it('should highlight the selected portfolio', () => {
    // Update mock state for this specific test
    (useAppStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      portfolios: mockPortfolios,
      selectPortfolio: mockSelectPortfolio,
      selectedPortfolioId: '2', // Set 'Crypto Fun' as selected
    });

    render(<PortfolioList />);

    // Assuming the selected item has a specific class or attribute
    // This depends on the actual implementation of PortfolioList
    // Example: Check if the 'Crypto Fun' item's parent has an 'ant-list-item-selected' class (adjust selector as needed)
    const selectedItem = screen.getByText('Crypto Fun').closest('.ant-list-item'); // Adjust selector based on Ant Design structure
    expect(selectedItem).toHaveClass('ant-list-item-selected'); // Example assertion, adjust class name
  });
});
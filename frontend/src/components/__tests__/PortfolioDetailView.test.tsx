import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PortfolioDetailView from '../PortfolioDetailView';
import useAppStore from '../../store'; // Default import

// Mock the Zustand store
vi.mock('../../store', () => ({
  default: vi.fn(), // Mock the default export
}));

// Mock child components to simplify testing the parent
vi.mock('../PortfolioSummary', () => ({ default: () => <div>Mock Portfolio Summary</div> }));
vi.mock('../PositionsTable', () => ({ default: () => <div>Mock Positions Table</div> }));
vi.mock('../TransactionList', () => ({ default: () => <div>Mock Transaction List</div> }));

const mockFetchPortfolioDetail = vi.fn();
const mockFetchCurrentPortfolioStats = vi.fn();

const mockPortfolioDetail = {
  id: 'test-id',
  name: 'Test Portfolio',
  currency: 'USD',
  positions: [],
  transactions: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  userId: 'user1',
  // Add other necessary fields based on PortfolioDetail type
};

const mockStats = {
    totalValue: 10000,
    totalCost: 9000,
    totalGainLoss: 1000,
    totalGainLossPercentage: 11.11,
    dailyGainLoss: 50,
    dailyGainLossPercentage: 0.5,
    // Add other stats fields
};


describe('PortfolioDetailView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup mock return value for the store hook
    (useAppStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      selectedPortfolioId: 'test-id',
      selectedPortfolioDetail: mockPortfolioDetail, // Provide mock detail data
      currentPortfolioStats: mockStats, // Provide mock stats data
      isLoadingPortfolioDetail: false,
      portfolioError: null,
      fetchPortfolioDetail: mockFetchPortfolioDetail,
      fetchCurrentPortfolioStats: mockFetchCurrentPortfolioStats,
      // Mock other state/actions used by the component if necessary
    });
  });

  it('should call fetchPortfolioDetail and fetchCurrentPortfolioStats on mount if selectedPortfolioId exists but detail/stats are null', async () => {
     // Reset mock state for this specific scenario
     (useAppStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        selectedPortfolioId: 'test-id',
        selectedPortfolioDetail: null, // Simulate detail not loaded yet
        currentPortfolioStats: null, // Simulate stats not loaded yet
        isLoadingPortfolioDetail: false,
        portfolioError: null,
        fetchPortfolioDetail: mockFetchPortfolioDetail,
        fetchCurrentPortfolioStats: mockFetchCurrentPortfolioStats,
      });

    render(<PortfolioDetailView portfolioId="test-id" />);

    // Check if actions were called (store logic handles this based on selectedPortfolioId)
    // Note: The component itself might not directly call these if the store logic handles it upon selection.
    // We verify the store's internal logic was likely triggered by checking if the actions were called.
    // Depending on implementation (useEffect in component vs. store logic), this might need adjustment.
    // Let's assume the store's selectPortfolio action triggers these fetches.
    // If the component has its own useEffect, we'd test that directly.

    // Since the store mock is set up *before* render, the initial calls might happen implicitly
    // via the selectPortfolio logic (which we assume was called previously to set selectedPortfolioId).
    // If the component itself has a useEffect hook to fetch data based on selectedPortfolioId,
    // we would expect the calls here. Let's refine the mock setup to reflect this possibility.

    // Re-mocking to simulate the component's potential useEffect trigger
    const fetchDetailFn = vi.fn();
    const fetchStatsFn = vi.fn();
     (useAppStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        selectedPortfolioId: 'test-id',
        selectedPortfolioDetail: null,
        currentPortfolioStats: null,
        isLoadingPortfolioDetail: false,
        portfolioError: null,
        fetchPortfolioDetail: fetchDetailFn, // Use fresh mocks for this test
        fetchCurrentPortfolioStats: fetchStatsFn,
      });

    render(<PortfolioDetailView portfolioId="test-id" />);

    // Assuming the component has a useEffect like:
    // useEffect(() => {
    //   if (selectedPortfolioId && (!selectedPortfolioDetail || !currentPortfolioStats)) {
    //     fetchPortfolioDetail(selectedPortfolioId);
    //     fetchCurrentPortfolioStats(selectedPortfolioId);
    //   }
    // }, [selectedPortfolioId, selectedPortfolioDetail, currentPortfolioStats, fetchPortfolioDetail, fetchCurrentPortfolioStats]);

    await waitFor(() => {
        expect(fetchDetailFn).toHaveBeenCalledWith('test-id');
        expect(fetchStatsFn).toHaveBeenCalledWith('test-id', undefined); // Assuming default period
    });
  });


  it('should render loading state if isLoadingPortfolioDetail is true', () => {
    (useAppStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      selectedPortfolioId: 'test-id',
      selectedPortfolioDetail: null,
      currentPortfolioStats: null,
      isLoadingPortfolioDetail: true, // Set loading to true
      portfolioError: null,
      fetchPortfolioDetail: mockFetchPortfolioDetail,
      fetchCurrentPortfolioStats: mockFetchCurrentPortfolioStats,
    });

    render(<PortfolioDetailView portfolioId="test-id" />);

    // Check for loading indicator (adjust based on actual implementation, e.g., Ant Design Spin)
    expect(screen.getByRole('alert', { name: /loading/i })).toBeInTheDocument(); // Example using Spin's default aria-label
  });

  it('should render error message if portfolioError exists', () => {
    const errorMessage = 'Failed to load details';
    (useAppStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      selectedPortfolioId: 'test-id',
      selectedPortfolioDetail: null,
      currentPortfolioStats: null,
      isLoadingPortfolioDetail: false,
      portfolioError: errorMessage, // Set error message
      fetchPortfolioDetail: mockFetchPortfolioDetail,
      fetchCurrentPortfolioStats: mockFetchCurrentPortfolioStats,
    });

    render(<PortfolioDetailView portfolioId="test-id" />);

    // Check for error message (adjust based on actual implementation, e.g., Ant Design Alert)
    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  it('should render child components when data is loaded', () => {
     // Use the initial beforeEach mock setup where data is available
     (useAppStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        selectedPortfolioId: 'test-id',
        selectedPortfolioDetail: mockPortfolioDetail,
        currentPortfolioStats: mockStats,
        isLoadingPortfolioDetail: false,
        portfolioError: null,
        fetchPortfolioDetail: mockFetchPortfolioDetail,
        fetchCurrentPortfolioStats: mockFetchCurrentPortfolioStats,
      });

    render(<PortfolioDetailView portfolioId="test-id" />);

    // Check if mocked child components are rendered
    expect(screen.getByText('Mock Portfolio Summary')).toBeInTheDocument();
    expect(screen.getByText('Mock Positions Table')).toBeInTheDocument();
    expect(screen.getByText('Mock Transaction List')).toBeInTheDocument();
  });

  it('should display a message if no portfolio is selected', () => {
    (useAppStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      selectedPortfolioId: null, // No portfolio selected
      selectedPortfolioDetail: null,
      currentPortfolioStats: null,
      isLoadingPortfolioDetail: false,
      portfolioError: null,
      fetchPortfolioDetail: mockFetchPortfolioDetail,
      fetchCurrentPortfolioStats: mockFetchCurrentPortfolioStats,
    });

    render(<PortfolioDetailView portfolioId={null} />);

    // Check for the placeholder message
    expect(screen.getByText(/Please select a portfolio/i)).toBeInTheDocument(); // Adjust text as needed
  });
});
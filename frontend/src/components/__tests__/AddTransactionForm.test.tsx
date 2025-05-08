import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event'; // Use user-event for better interaction simulation
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AddTransactionForm from '../AddTransactionForm';
import useAppStore from '../../store'; // Default import
import { TransactionType } from '../../store/types';

// Mock the Zustand store
vi.mock('../../store', () => ({
  default: vi.fn(), // Mock the default export
}));

// Mock Ant Design components used internally if they cause issues (optional)
// vi.mock('antd', async (importOriginal) => {
//   const antd = await importOriginal();
//   return {
//     ...antd,
//     DatePicker: () => <input data-testid="mock-datepicker" />, // Example mock
//   };
// });


const mockAddTransaction = vi.fn();
const mockPortfolioId = 'portfolio-abc';

describe('AddTransactionForm Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup mock return value for the store hook
    (useAppStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      // Only mock the actions/state needed by AddTransactionForm
      addTransaction: mockAddTransaction,
      selectedPortfolioId: mockPortfolioId, // Provide the ID needed by the form
      // Add other state if the form uses it
    });
  });

  it('should render all form fields correctly', () => {
    render(<AddTransactionForm portfolioId={mockPortfolioId} />);

    // Check for key form elements (adjust selectors based on actual implementation)
    expect(screen.getByLabelText(/date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/asset code/i)).toBeInTheDocument(); // Initially might be disabled/hidden depending on type
    expect(screen.getByLabelText(/quantity/i)).toBeInTheDocument(); // Initially might be disabled/hidden
    expect(screen.getByLabelText(/price/i)).toBeInTheDocument(); // Initially might be disabled/hidden
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument(); // Might be disabled for BUY/SELL initially
    expect(screen.getByLabelText(/note/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add transaction/i })).toBeInTheDocument();
  });

  it('should enable/disable fields based on transaction type selection', async () => {
    const user = userEvent.setup();
    render(<AddTransactionForm portfolioId={mockPortfolioId} />);

    const typeSelect = screen.getByLabelText(/type/i);

    // Initial state (assuming default is BUY or similar)
    expect(screen.getByLabelText(/asset code/i)).toBeEnabled();
    expect(screen.getByLabelText(/quantity/i)).toBeEnabled();
    expect(screen.getByLabelText(/price/i)).toBeEnabled();
    expect(screen.getByLabelText(/amount/i)).toBeDisabled(); // Amount usually calculated for BUY/SELL

    // Change type to DEPOSIT
    await user.click(typeSelect); // Open the select dropdown
    await user.click(screen.getByText(TransactionType.DEPOSIT)); // Select DEPOSIT option

    // Check fields for DEPOSIT type
    expect(screen.getByLabelText(/asset code/i)).toBeDisabled();
    expect(screen.getByLabelText(/quantity/i)).toBeDisabled();
    expect(screen.getByLabelText(/price/i)).toBeDisabled();
    expect(screen.getByLabelText(/amount/i)).toBeEnabled();

     // Change type back to BUY
     await user.click(typeSelect);
     await user.click(screen.getByText(TransactionType.BUY));

     // Check fields are re-enabled/disabled correctly
     expect(screen.getByLabelText(/asset code/i)).toBeEnabled();
     expect(screen.getByLabelText(/quantity/i)).toBeEnabled();
     expect(screen.getByLabelText(/price/i)).toBeEnabled();
     expect(screen.getByLabelText(/amount/i)).toBeDisabled();
  });


  it('should call addTransaction with correct data on form submission (BUY)', async () => {
    const user = userEvent.setup();
    render(<AddTransactionForm portfolioId={mockPortfolioId} />);

    // Select type (assuming default isn't BUY or just to be explicit)
    const typeSelect = screen.getByLabelText(/type/i);
    await user.click(typeSelect);
    await user.click(screen.getByText(TransactionType.BUY));

    // Fill in the form fields
    // Note: DatePicker needs careful handling. If not mocked, interact with its input.
    // await user.type(screen.getByLabelText(/date/i), '2024-03-10'); // This might not work directly with AntD DatePicker
    // For AntD DatePicker, you might need to click it, then click the date in the popup.
    // Or mock DatePicker for simplicity if direct interaction is complex.
    await user.type(screen.getByLabelText(/asset code/i), 'NVDA');
    await user.type(screen.getByLabelText(/quantity/i), '10');
    await user.type(screen.getByLabelText(/price/i), '800');
    await user.type(screen.getByLabelText(/note/i), 'Bought NVDA shares');

    // Click submit button
    const submitButton = screen.getByRole('button', { name: /add transaction/i });
    await user.click(submitButton);

    // Check if addTransaction was called
    expect(mockAddTransaction).toHaveBeenCalledTimes(1);

    // Check the arguments passed to addTransaction
    // The date might be tricky due to formatting/DatePicker interaction.
    // We check the core data for now. Amount is calculated for BUY.
    expect(mockAddTransaction).toHaveBeenCalledWith(
      mockPortfolioId,
      expect.objectContaining({
        // date: expect.any(String), // Or a specific format if DatePicker is handled
        type: TransactionType.BUY,
        assetCode: 'NVDA',
        quantity: 10,
        price: 800,
        amount: 8000, // Calculated: 10 * 800
        note: 'Bought NVDA shares',
      })
    );
  });

   it('should call addTransaction with correct data on form submission (DEPOSIT)', async () => {
    const user = userEvent.setup();
    render(<AddTransactionForm portfolioId={mockPortfolioId} />);

    // Select type
    const typeSelect = screen.getByLabelText(/type/i);
    await user.click(typeSelect);
    await user.click(screen.getByText(TransactionType.DEPOSIT));

    // Fill in the amount field
    await user.type(screen.getByLabelText(/amount/i), '5000');
    await user.type(screen.getByLabelText(/note/i), 'Initial deposit');

    // Click submit button
    const submitButton = screen.getByRole('button', { name: /add transaction/i });
    await user.click(submitButton);

    // Check if addTransaction was called
    expect(mockAddTransaction).toHaveBeenCalledTimes(1);

    // Check the arguments passed to addTransaction
    expect(mockAddTransaction).toHaveBeenCalledWith(
      mockPortfolioId,
      expect.objectContaining({
        type: TransactionType.DEPOSIT,
        assetCode: undefined, // Or null, depending on implementation
        quantity: undefined,
        price: undefined,
        amount: 5000,
        note: 'Initial deposit',
      })
    );
  });

  // Add more tests for validation errors if needed
});
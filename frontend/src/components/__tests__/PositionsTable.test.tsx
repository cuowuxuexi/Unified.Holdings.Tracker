import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PositionsTable from '../PositionsTable';
import { PositionWithStats } from '../../store/types'; // Use PositionWithStats type

// Mock data for positions conforming to PositionWithStats
const mockPositions: PositionWithStats[] = [
  {
    asset: {
      code: 'AAPL',
      name: 'Apple Inc.',
    },
    quantity: 10,
    costPrice: 150.00,
    currentPrice: 175.50,
    marketValue: 1755.00,
    totalPnl: 255.00,
    totalPnlPercent: 17.00,
    dailyChange: 10.50,
    dailyChangePercent: 0.60,
  },
  {
    asset: {
      code: 'GOOGL',
      name: 'Alphabet Inc.',
    },
    quantity: 5,
    costPrice: 2500.00,
    currentPrice: 2750.00,
    marketValue: 13750.00,
    totalPnl: 1250.00,
    totalPnlPercent: 10.00,
    dailyChange: -50.00,
    dailyChangePercent: -0.36,
  },
];

describe('PositionsTable Component', () => {
  it('should render the table with correct headers and data', () => {
    render(<PositionsTable positions={mockPositions} />);

    // Check if the table is rendered
    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();

    // Check for column headers (adjust text based on actual implementation)
    expect(within(table).getByRole('columnheader', { name: /symbol/i })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /name/i })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /quantity/i })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /cost price/i })).toBeInTheDocument(); // Updated header name
    expect(within(table).getByRole('columnheader', { name: /current price/i })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /market value/i })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /total pnl/i })).toBeInTheDocument(); // Updated header name
    expect(within(table).getByRole('columnheader', { name: /total pnl %/i })).toBeInTheDocument(); // Updated header name
    expect(within(table).getByRole('columnheader', { name: /daily change/i })).toBeInTheDocument(); // Added header check
    expect(within(table).getByRole('columnheader', { name: /daily change %/i })).toBeInTheDocument(); // Added header check

    // Check for the correct number of data rows (excluding header row)
    // Ant Design table structure might have multiple tbody elements or nested rows.
    // A more robust way might be to find rows within the main tbody.
    const tableBody = within(table).getAllByRole('rowgroup')[1]; // Assuming second rowgroup is tbody
    expect(within(tableBody).getAllByRole('row')).toHaveLength(mockPositions.length);


    // Check for specific data points in the rows
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('Apple Inc.')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument(); // Quantity for AAPL
    expect(screen.getByText('175.50')).toBeInTheDocument(); // Current Price for AAPL
    expect(screen.getByText('255.00')).toBeInTheDocument(); // Total PnL for AAPL

    expect(screen.getByText('GOOGL')).toBeInTheDocument();
    expect(screen.getByText('Alphabet Inc.')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument(); // Quantity for GOOGL
    expect(screen.getByText('2750.00')).toBeInTheDocument(); // Current Price for GOOGL
    expect(screen.getByText('1250.00')).toBeInTheDocument(); // Total PnL for GOOGL
  });

  it('should render an empty state or message when no positions are provided', () => {
    render(<PositionsTable positions={[]} />); // Pass empty array

    // Check for Ant Design's default empty description or a custom message
    // This depends on how the component handles empty data.
    // Option 1: Check for Ant Design's default text
    expect(screen.getByText(/no data/i)).toBeInTheDocument();

    // Option 2: If you have a custom message/component for empty state
    // expect(screen.getByText(/you have no open positions/i)).toBeInTheDocument();
  });
});
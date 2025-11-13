import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { RootLayout } from './RootLayout';
import { PortfolioListPage } from '../../features/portfolio/pages/PortfolioListPage';
import { PortfolioDetailPage } from '../../features/portfolio/pages/PortfolioDetailPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <PortfolioListPage />,
      },
      {
        path: 'portfolio/:id',
        element: <PortfolioDetailPage />,
      },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}


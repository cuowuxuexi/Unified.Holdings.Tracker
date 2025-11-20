import { createHashRouter, RouterProvider } from 'react-router-dom';
import { RootLayout } from './RootLayout';
import { PortfolioListPage } from '../../features/portfolio/pages/PortfolioListPage';
import { PortfolioDetailPage } from '../../features/portfolio/pages/PortfolioDetailPage';

// 使用 HashRouter 以支持 Electron 的 file:// 协议
const router = createHashRouter([
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

import { AppProviders } from './app/providers';
import { AppRouter } from './app/routes';
import './index.css';

function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}

export default App;


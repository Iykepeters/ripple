import { useAuth } from './context/AuthContext.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import Dashboard from './components/Dashboard.jsx';
import InstallBanner from './components/InstallBanner.jsx';
import './App.css';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading-shell">Loading Ripple…</div>;
  }

  return (
    <>
      {user && <InstallBanner />}
      {user ? <Dashboard /> : <AuthScreen />}
    </>
  );
}

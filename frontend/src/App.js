import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import SubmitPage from './components/SubmitPage';
import AdminPage from './components/AdminPage';
import AuditDetail from './components/AuditDetail';

function Navbar() {
  const location = useLocation();
  return (
    <nav className="top-nav">
      <div style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-1px' }}>Claivo.</div>
      <div>
        <Link to="/submit" className="nav-link" style={{ fontWeight: location.pathname.includes('/submit') ? 800 : 400 }}>Employee</Link>
        <Link to="/admin" className="nav-link" style={{ fontWeight: location.pathname.includes('/admin') || location.pathname.includes('/audit') ? 800 : 400 }}>Auditor</Link>
      </div>
    </nav>
  );
}

function App() {
  return (
    <Router>
      <Navbar />
      <Routes>
        <Route path="/" element={<Navigate to="/submit" replace />} />
        <Route path="/submit" element={<SubmitPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/audit/:claim_id" element={<AuditDetail />} />
      </Routes>
    </Router>
  );
}

export default App;
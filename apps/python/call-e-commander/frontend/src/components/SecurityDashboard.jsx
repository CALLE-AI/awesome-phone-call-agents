import { useState, useEffect } from 'react';
import { ShieldAlert, LogOut, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';

export default function SecurityDashboard() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const token = sessionStorage.getItem('medops_jwt');
      const API_BASE = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_BASE}/api/audit`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.status === 401 || response.status === 403) {
        throw new Error("Unauthorized. Only security administrators can view these logs.");
      }
      
      if (!response.ok) {
        throw new Error("Failed to fetch audit logs.");
      }
      
      const data = await response.json();
      setLogs(data.logs || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    sessionStorage.removeItem('medops_jwt');
    navigate('/login');
  };

  return (
    <div style={{ maxWidth: '1000px', margin: '2rem auto', padding: '0 1rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, color: 'var(--color-primary-blue)' }}>
            <ShieldAlert size={28} />
            Security & Compliance Dashboard
          </h1>
          <p style={{ margin: '0.5rem 0 0 0', color: '#666' }}>Enterprise Audit Logs & Access Control</p>
        </div>
        
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={() => navigate('/dashboard')} className="btn btn-secondary">
            Back to Planner
          </button>
          <button onClick={handleLogout} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </header>

      {error ? (
        <div className="card" style={{ backgroundColor: '#ffebee', color: 'var(--color-danger-red)' }}>
          <h3>Access Denied</h3>
          <p>{error}</p>
        </div>
      ) : (
        <div className="card">
          <h2 style={{ borderBottom: '1px solid #eee', paddingBottom: '1rem', marginTop: 0 }}>
            Recent Activity Logs
          </h2>
          
          {loading ? (
            <p>Loading audit logs...</p>
          ) : logs.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#666', padding: '2rem' }}>
              <CheckCircle2 size={48} style={{ color: 'var(--color-success-green)', margin: '0 auto 1rem auto', display: 'block' }} />
              No security events found.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f5f7fa', textAlign: 'left' }}>
                    <th style={{ padding: '0.75rem', borderBottom: '2px solid #eee' }}>Timestamp</th>
                    <th style={{ padding: '0.75rem', borderBottom: '2px solid #eee' }}>Action</th>
                    <th style={{ padding: '0.75rem', borderBottom: '2px solid #eee' }}>Admin ID</th>
                    <th style={{ padding: '0.75rem', borderBottom: '2px solid #eee' }}>Plan ID</th>
                    <th style={{ padding: '0.75rem', borderBottom: '2px solid #eee' }}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '0.75rem' }}>{new Date(log.timestamp).toLocaleString()}</td>
                      <td style={{ padding: '0.75rem', fontWeight: 600 }}>{log.action}</td>
                      <td style={{ padding: '0.75rem' }}>{log.admin_id}</td>
                      <td style={{ padding: '0.75rem', fontFamily: 'monospace' }}>{log.plan_id || 'N/A'}</td>
                      <td style={{ padding: '0.75rem' }}>{log.reason || 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

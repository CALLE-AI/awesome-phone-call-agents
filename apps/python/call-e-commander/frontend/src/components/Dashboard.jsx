import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, ShieldCheck, Activity, PhoneCall } from 'lucide-react';
import { useIdleTimeout } from '../hooks/useIdleTimeout';

export default function Dashboard() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  // 3 minute Security timeout
  const isIdle = useIdleTimeout(180000);

  const fetchPlans = async () => {
    const token = sessionStorage.getItem('medops_jwt');
    if (!token) {
      navigate('/login');
      return;
    }

    try {
      const API_BASE = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_BASE}/api/plans`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.status === 401) {
        sessionStorage.removeItem('medops_jwt');
        navigate('/login');
        return;
      }

      if (!response.ok) throw new Error('Failed to fetch plans');

      const data = await response.json();
      setPlans(data.plans || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchPlans();
    const interval = setInterval(fetchPlans, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    sessionStorage.removeItem('medops_jwt');
    navigate('/login');
  };

  const handleTrigger = async (eventType) => {
    const token = sessionStorage.getItem('medops_jwt');
    try {
      const API_BASE = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_BASE}/api/events/trigger`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          event_type: eventType,
          patient_id: "PAT-TEST-1",
          patient_phone: "+12125550101",
          source_system: "opendental"
        })
      });
      if (!response.ok) {
         if(response.status === 401) {
            navigate('/login');
            return;
         }
         throw new Error('Failed to trigger event');
      }
      fetchPlans();
    } catch (err) {
      alert(err.message);
    }
  };

  if (isIdle) {
    return (
      <div className="login-container idle-blur">
        <div className="login-card card">
           <h3>Session Expired</h3>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="header">
        <div className="header-title">
          <Activity size={24} />
          CALL-E Commander
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div className="hipaa-badge">
            <ShieldCheck size={14} /> SECURED
          </div>
          <button onClick={handleLogout} className="btn btn-outline" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <LogOut size={16} /> Logout
          </button>
        </div>
      </header>

      <main className="main-content">
        <div className="card">
          <h2 className="card-title">Trigger Manual Events</h2>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => handleTrigger('missed_appointment')}>
              Missed Appointment
            </button>
            <button className="btn btn-primary" onClick={() => handleTrigger('high_balance')}>
              High Balance
            </button>
            <button className="btn btn-primary" onClick={() => handleTrigger('unknown_event')}>
              Unknown Event
            </button>
          </div>
        </div>

        <div className="card">
          <h2 className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            Active Call Plans
            <span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--color-text-muted)' }}>
              Auto-refreshing every 5s
            </span>
          </h2>
          
          {loading ? (
            <p style={{ color: 'var(--color-text-muted)' }}>Loading plans...</p>
          ) : error ? (
            <p style={{ color: 'var(--color-danger-red)' }}>{error}</p>
          ) : plans.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)' }}>No active call plans in the queue.</p>
          ) : (
            <div className="table-wrapper">
              <table className="clinical-table">
                <thead>
                  <tr>
                    <th>Plan ID</th>
                    <th>Agent</th>
                    <th>Patient ID</th>
                    <th>Consent</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr key={plan.plan_id}>
                      <td style={{ fontFamily: 'monospace' }}>{plan.plan_id.substring(0, 8)}...</td>
                      <td>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <PhoneCall size={14} /> {plan.agent}
                        </span>
                      </td>
                      <td>{plan.patient_id}</td>
                      <td>
                        <span className={`status-badge ${plan.consent_granted ? 'status-completed' : 'status-pending'}`}>
                          {plan.consent_granted ? 'Granted' : 'Denied/Pending'}
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge ${plan.status === 'completed' ? 'status-completed' : 'status-pending'}`}>
                          {plan.status.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

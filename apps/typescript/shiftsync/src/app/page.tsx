'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  CoverageWorkflowState, 
  DashboardMetrics, 
  Employee, 
  CallAttempt 
} from '@/types';

export default function ShiftSyncApp() {
  // Form State
  const [role, setRole] = useState('Bartender');
  const [date, setDate] = useState('Today');
  const [startTime, setStartTime] = useState('6:00 PM');
  const [endTime, setEndTime] = useState('11:00 PM');
  const [location, setLocation] = useState('The Copper Bistro — Main Branch');
  const [workersNeeded, setWorkersNeeded] = useState(1);
  const [mode, setMode] = useState<'live' | 'simulation'>('live');
  const [scenario, setScenario] = useState<'standard' | 'conditional'>('standard');

  // Server Data
  const [workflow, setWorkflow] = useState<CoverageWorkflowState | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    openShifts: 1,
    callsMade: 0,
    coverageFound: 0,
    estMinutesSaved: 0
  });
  const [staff, setStaff] = useState<Employee[]>([]);

  // UI Modals & Test Call
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testCallStatus, setTestCallStatus] = useState<string | null>(null);

  // Fetch current state
  const fetchData = useCallback(async () => {
    try {
      const [covRes, staffRes] = await Promise.all([
        fetch('/api/coverage'),
        fetch('/api/staff')
      ]);

      if (covRes.ok) {
        const data = await covRes.json();
        setWorkflow(data.activeWorkflow);
        if (data.metrics) setMetrics(data.metrics);
      }

      if (staffRes.ok) {
        const staffData = await staffRes.json();
        setStaff(staffData.staff || []);
      }
    } catch (err) {
      console.error('Fetch error:', err);
    }
  }, []);

  // Polling loop when workflow is searching
  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      fetchData();
    }, 2500);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Start Coverage Search
  const handleStartCoverage = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/coverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          date,
          startTime,
          endTime,
          location,
          workersNeeded,
          businessName: 'The Copper Bistro',
          mode,
          scenario
        })
      });
      const data = await res.json();
      if (data.workflow) {
        setWorkflow(data.workflow);
      }
    } catch (err) {
      console.error('Start error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Stop / Cancel Search
  const handleCancelCoverage = async () => {
    try {
      await fetch('/api/coverage', { method: 'DELETE' });
      fetchData();
    } catch (err) {
      console.error('Cancel error:', err);
    }
  };

  // Conditional Actions
  const handleConditionalAction = async (action: 'approve' | 'continue') => {
    if (!workflow) return;
    try {
      const res = await fetch('/api/coverage/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: workflow.requestId,
          action
        })
      });
      const data = await res.json();
      if (data.workflow) setWorkflow(data.workflow);
    } catch (err) {
      console.error('Action error:', err);
    }
  };

  // Update staff member
  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmployee) return;
    try {
      await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingEmployee)
      });
      setEditingEmployee(null);
      fetchData();
    } catch (err) {
      console.error('Staff save error:', err);
    }
  };

  // Direct Single Test Call
  const handleDirectTestCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPhone) return;
    setTestCallStatus('Dialing test call via CALL-E...');
    try {
      const res = await fetch('/api/test-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: testPhone, role, employeeName: 'Staff Member' })
      });
      const data = await res.json();
      if (data.success) {
        setTestCallStatus(`✓ Outbound call queued! Task ID: ${data.callId}`);
      } else {
        setTestCallStatus(`✕ Failed: ${data.error}`);
      }
    } catch (err: any) {
      setTestCallStatus(`✕ Error: ${err.message}`);
    }
  };

  const filteredStaff = staff.filter(s => s.role.toLowerCase() === role.toLowerCase());
  const isSearching = workflow?.status === 'searching';

  return (
    <div className="container">
      {/* Header */}
      <header className="header">
        <div className="brand-section">
          <div className="logo-badge">⚡</div>
          <div>
            <h1 className="brand-title">ShiftSync</h1>
            <p className="brand-tagline">The autonomous last-minute staffing agent</p>
          </div>
        </div>

        <div className="header-actions">
          <div className="badge-calle">
            <span className="pulse-dot"></span>
            <span>CALL-E Voice Runtime</span>
          </div>

          <button 
            className="btn btn-secondary" 
            style={{ fontSize: '12px', padding: '6px 14px' }}
            onClick={() => setShowStaffModal(true)}
          >
            👥 Staff Pool ({staff.length})
          </button>
        </div>
      </header>

      {/* Metrics Row */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Open Shifts</div>
          <div className="metric-value" style={{ color: workflow && workflow.status === 'covered' ? '#10B981' : '#F59E0B' }}>
            {workflow && workflow.status === 'covered' ? 0 : metrics.openShifts}
          </div>
          <div className="metric-sub">{workflow?.status === 'covered' ? 'All shifts covered' : 'Urgent coverage needed'}</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Calls Made</div>
          <div className="metric-value">{workflow ? workflow.attempts.length : metrics.callsMade}</div>
          <div className="metric-sub">Autonomous dials via CALL-E</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Coverage Found</div>
          <div className="metric-value" style={{ color: '#10B981' }}>
            {workflow?.status === 'covered' ? 1 : metrics.coverageFound}
          </div>
          <div className="metric-sub">Confirmed acceptances</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Time Saved</div>
          <div className="metric-value">
            ~{workflow ? Math.max(15, workflow.attempts.length * 12) : Math.max(30, metrics.estMinutesSaved)}m
          </div>
          <div className="metric-sub">Est. manual phone time saved</div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="dashboard-grid">
        {/* Left Column: Request Form & Eligible Staff */}
        <div className="left-col">
          {/* Request Card */}
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Create Coverage Request</h2>
                <p className="card-desc">Specify shift details to trigger sequential dials</p>
              </div>
            </div>

            {/* Mode Switcher */}
            <div className="mode-toggle">
              <button 
                type="button"
                className={`mode-btn ${mode === 'live' ? 'active' : ''}`}
                onClick={() => setMode('live')}
              >
                🔴 Live CALL-E Dialing
              </button>
              <button 
                type="button"
                className={`mode-btn ${mode === 'simulation' ? 'active' : ''}`}
                onClick={() => setMode('simulation')}
              >
                🧪 Demo Simulation
              </button>
            </div>

            <form onSubmit={handleStartCoverage}>
              {mode === 'simulation' && (
                <div className="form-group" style={{ background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.25)', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
                  <label className="form-label" style={{ color: '#A5B4FC', fontWeight: 700, fontSize: '12px' }}>
                    🎬 Demo Video Scenario
                  </label>
                  <select 
                    className="form-select"
                    value={scenario}
                    onChange={e => setScenario(e.target.value as any)}
                    disabled={isSearching}
                    style={{ fontSize: '13px' }}
                  >
                    <option value="standard">1. Standard Cascade (Alex declines → David no answer → James accepts)</option>
                    <option value="conditional">2. Nuanced Conditional (Employee arrives at 7:00 PM → Manager review)</option>
                  </select>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Employee Role</label>
                <select 
                  className="form-select"
                  value={role} 
                  onChange={e => setRole(e.target.value)}
                  disabled={isSearching}
                >
                  <option value="Bartender">Bartender</option>
                  <option value="Server">Server</option>
                  <option value="Cashier">Cashier</option>
                  <option value="Cook">Cook</option>
                </select>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Shift Date</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={date} 
                    onChange={e => setDate(e.target.value)}
                    disabled={isSearching}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Workers Needed</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    value={workersNeeded} 
                    min={1} 
                    max={5}
                    onChange={e => setWorkersNeeded(Number(e.target.value))}
                    disabled={isSearching}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Start Time</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={startTime} 
                    onChange={e => setStartTime(e.target.value)}
                    disabled={isSearching}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">End Time</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={endTime} 
                    onChange={e => setEndTime(e.target.value)}
                    disabled={isSearching}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Location / Branch</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={location} 
                  onChange={e => setLocation(e.target.value)}
                  disabled={isSearching}
                />
              </div>

              {isSearching ? (
                <button 
                  type="button" 
                  className="btn btn-danger" 
                  style={{ width: '100%' }}
                  onClick={handleCancelCoverage}
                >
                  ⏹ Stop Automated Search
                </button>
              ) : (
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={isSubmitting || filteredStaff.length === 0}
                >
                  ⚡ Find Coverage
                </button>
              )}
            </form>
          </div>

          {/* Qualified Staff Pool Preview */}
          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">Eligible Staff Pool</h3>
                <p className="card-desc">Ordered by priority for role: <strong>{role}</strong></p>
              </div>
              <button 
                className="btn btn-secondary" 
                style={{ fontSize: '11px', padding: '4px 10px' }}
                onClick={() => setShowStaffModal(true)}
              >
                Edit Numbers
              </button>
            </div>

            <div className="candidate-list">
              {filteredStaff.length === 0 ? (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  No staff members configured with role "{role}".
                </div>
              ) : (
                filteredStaff.map((emp, idx) => (
                  <div key={emp.id} className="candidate-item">
                    <div className="candidate-meta">
                      <div className="candidate-avatar">#{emp.priority || idx + 1}</div>
                      <div>
                        <div className="candidate-name">{emp.name}</div>
                        <div className="candidate-role">{emp.phone}</div>
                      </div>
                    </div>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: '11px', padding: '4px 8px' }}
                      onClick={() => setEditingEmployee(emp)}
                    >
                      Change Phone
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Active Coverage Cascade & Timeline */}
        <div className="right-col">
          {/* Active Search & Outcome Banner */}
          <div className="card">
            <div className="card-header">
              <div>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--accent-primary)', fontWeight: 700, letterSpacing: '0.08em' }}>
                  Coverage Search
                </div>
                <h2 className="card-title" style={{ marginTop: '2px' }}>
                  {role} · {date} ({startTime} – {endTime})
                </h2>
                <div className="card-desc">{location}</div>
              </div>

              {workflow && (
                <div className="status-badge" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  {workflow.attempts.length} / {workflow.candidates.length} candidates contacted
                </div>
              )}
            </div>

            {/* Outcome Display */}
            {workflow?.status === 'covered' && workflow.confirmedEmployee && (
              <div className="outcome-banner covered">
                <div className="outcome-title">
                  <span>✓</span> COVERAGE FOUND
                </div>
                <div className="outcome-meta">
                  <strong>{workflow.confirmedEmployee.name}</strong> confirmed availability as <strong>{role}</strong> on {date} ({startTime} – {endTime}).
                  <br />
                  <span style={{ color: '#34D399', fontSize: '13px' }}>
                    🟢 Confirmed by phone through CALL-E. No further action required.
                  </span>
                </div>
                {workflow.confirmedResult?.notes && (
                  <div style={{ fontSize: '13px', background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: '6px' }}>
                    <strong>Call Summary:</strong> {workflow.confirmedResult.notes}
                  </div>
                )}
              </div>
            )}

            {workflow?.status === 'conditional_review' && workflow.confirmedEmployee && (
              <div className="outcome-banner conditional_review">
                <div className="outcome-title">
                  <span>⚠️</span> CONDITIONAL COVERAGE
                </div>
                <div className="outcome-meta">
                  <strong>{workflow.confirmedEmployee.name}</strong> can cover, but only from <strong>{workflow.confirmedResult?.available_from || 'a modified start time'}</strong>.
                  <br />
                  <span style={{ color: '#FBBF24', fontSize: '13px' }}>
                    Manager approval required.
                  </span>
                </div>
                {workflow.confirmedResult?.notes && (
                  <div style={{ fontSize: '13px', background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: '6px' }}>
                    <strong>Employee Note:</strong> {workflow.confirmedResult.notes}
                  </div>
                )}
                <div className="outcome-actions">
                  <button 
                    className="btn btn-success" 
                    style={{ fontSize: '13px', padding: '8px 16px' }}
                    onClick={() => handleConditionalAction('approve')}
                  >
                    ✓ Approve Conditional Shift
                  </button>
                  <button 
                    className="btn btn-secondary" 
                    style={{ fontSize: '13px', padding: '8px 16px' }}
                    onClick={() => handleConditionalAction('continue')}
                  >
                    Call Next Candidate →
                  </button>
                </div>
              </div>
            )}

            {workflow?.status === 'no_coverage' && (
              <div className="outcome-banner no_coverage">
                <div className="outcome-title">
                  <span>✕</span> No Coverage Found
                </div>
                <div className="outcome-meta">
                  We contacted all eligible employees, but nobody confirmed availability.
                </div>
              </div>
            )}

            {/* Candidate Sequential Cascade */}
            <div style={{ marginTop: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '10px' }}>
                Sequential Calling Cascade
              </div>

              {!workflow || workflow.candidates.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', background: 'rgba(11, 17, 30, 0.4)', borderRadius: '8px' }}>
                  Click <strong>Find Coverage</strong> to trigger sequential automated dialing.
                </div>
              ) : (
                <div className="candidate-list">
                  {workflow.candidates.map((candidate, idx) => {
                    const attempt = workflow.attempts.find(a => a.employeeId === candidate.id);
                    const isCurrent = workflow.status === 'searching' && workflow.currentIndex === idx;
                    const isConfirmed = workflow.confirmedEmployee?.id === candidate.id;

                    let badgeClass = 'status-badge';
                    let badgeText = 'Pending';

                    if (attempt?.status === 'calling') {
                      badgeClass += ' calling';
                      badgeText = 'Dialing...';
                    } else if (attempt?.outcome === 'accepted' || isConfirmed) {
                      badgeClass += ' accepted';
                      badgeText = '✓ Accepted';
                    } else if (attempt?.outcome === 'conditional') {
                      badgeClass += ' conditional';
                      badgeText = '⚠️ Conditional';
                    } else if (attempt?.outcome === 'declined') {
                      badgeClass += ' declined';
                      badgeText = '✕ Declined';
                    } else if (attempt?.outcome === 'no_answer' || attempt?.outcome === 'voicemail') {
                      badgeClass += ' no_answer';
                      badgeText = 'No Answer';
                    }

                    return (
                      <div 
                        key={candidate.id} 
                        className={`candidate-item ${isCurrent ? 'active' : ''} ${isConfirmed ? 'accepted' : ''}`}
                      >
                        <div className="candidate-meta">
                          <div className="candidate-avatar">
                            {idx + 1}
                          </div>
                          <div>
                            <div className="candidate-name">
                              {candidate.name}
                              {isCurrent && <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--accent-primary)' }}>● in progress</span>}
                            </div>
                            <div className="candidate-role">{candidate.phone}</div>
                          </div>
                        </div>

                        <div className={badgeClass}>
                          {badgeText}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Transcript / Spoken Evidence */}
          {workflow && workflow.attempts.some(a => a.transcriptTurns && a.transcriptTurns.length > 0) && (
            <div className="card">
              <div className="card-header">
                <div>
                  <h3 className="card-title">CALL-E Spoken Evidence & Transcript</h3>
                  <p className="card-desc">Direct verbatim turns extracted from telephony runtime</p>
                </div>
              </div>

              {workflow.attempts
                .filter(a => a.transcriptTurns && a.transcriptTurns.length > 0)
                .map(a => (
                  <div key={a.id} style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                      Call to {a.employeeName} ({a.phone}) — Outcome: <strong style={{ textTransform: 'uppercase' }}>{a.outcome}</strong>
                    </div>
                    <div className="transcript-box">
                      {a.transcriptTurns?.map((turn, tIdx) => (
                        <div key={tIdx} className={`turn ${turn.speaker === 'bot' ? 'bot' : 'user'}`}>
                          <div className="turn-speaker">{turn.speaker === 'bot' ? 'ShiftSync (CALL-E AI)' : a.employeeName}</div>
                          <div>{turn.text}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* Activity Timeline */}
          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">Activity Timeline</h3>
                <p className="card-desc">Real-time audit log of automated scheduling steps</p>
              </div>
            </div>

            {!workflow || workflow.timeline.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                No activity recorded yet.
              </div>
            ) : (
              <div className="timeline">
                {workflow.timeline.map((event) => (
                  <div key={event.id} className="timeline-item">
                    <div className={`timeline-marker ${event.type}`}></div>
                    <div className="timeline-time">{event.timestamp}</div>
                    <div className="timeline-title">{event.title}</div>
                    <div className="timeline-desc">{event.description}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Staff Pool & Edit Modal */}
      {showStaffModal && (
        <div className="modal-overlay" onClick={() => setShowStaffModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="card-header">
              <h3 className="card-title">Staff Pool Configuration</h3>
              <button 
                className="btn btn-secondary" 
                style={{ padding: '4px 10px', fontSize: '12px' }}
                onClick={() => setShowStaffModal(false)}
              >
                ✕ Close
              </button>
            </div>
            <p className="card-desc" style={{ marginBottom: '16px' }}>
              Update employee phone numbers so CALL-E calls your real test phone during evaluation.
            </p>

            {/* Quick Test Call Direct Form */}
            <div style={{ background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.3)', padding: '16px', borderRadius: '12px', marginBottom: '20px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#A5B4FC', marginBottom: '6px' }}>
                📞 Quick Test Outbound Call via CALL-E
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                Test your CALL-E connection immediately by placing a one-off call to any phone number.
              </div>
              <form onSubmit={handleDirectTestCall} style={{ display: 'flex', gap: '8px' }}>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="+12345678900" 
                  value={testPhone} 
                  onChange={e => setTestPhone(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button type="submit" className="btn btn-primary" style={{ width: 'auto', padding: '0 16px' }}>
                  Call Now
                </button>
              </form>
              {testCallStatus && (
                <div style={{ marginTop: '8px', fontSize: '12px', color: testCallStatus.startsWith('✓') ? '#34D399' : '#FCA5A5' }}>
                  {testCallStatus}
                </div>
              )}
            </div>

            {/* Staff List */}
            <div className="candidate-list">
              {staff.map(emp => (
                <div key={emp.id} className="candidate-item">
                  <div>
                    <div className="candidate-name">{emp.name} <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({emp.role})</span></div>
                    <div className="candidate-role">{emp.phone}</div>
                  </div>
                  <button 
                    className="btn btn-secondary"
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                    onClick={() => setEditingEmployee(emp)}
                  >
                    Edit
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Edit Single Employee Dialog */}
      {editingEmployee && (
        <div className="modal-overlay" onClick={() => setEditingEmployee(null)}>
          <div className="modal-content" style={{ maxWidth: '440px' }} onClick={e => e.stopPropagation()}>
            <h3 className="card-title" style={{ marginBottom: '16px' }}>
              Edit Employee: {editingEmployee.name}
            </h3>
            <form onSubmit={handleSaveStaff}>
              <div className="form-group">
                <label className="form-label">Phone Number (E.164 format)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={editingEmployee.phone}
                  onChange={e => setEditingEmployee({ ...editingEmployee, phone: e.target.value })}
                  placeholder="+12345678900"
                  required
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                  Enter your real phone number here to receive CALL-E calls during testing.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label">Calling Priority (1 = First to call)</label>
                <input 
                  type="number" 
                  className="form-input" 
                  value={editingEmployee.priority || 1}
                  min={1}
                  max={10}
                  onChange={e => setEditingEmployee({ ...editingEmployee, priority: Number(e.target.value) })}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  Save
                </button>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => setEditingEmployee(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect } from 'react';

const STATUS_COLORS = {
  pending: '#999',
  planned: '#ff6600',
  approved: '#007bff',
  completed: '#28a745',
  failed: '#dc3545',
  cancelled: '#dc3545',
  rejected: '#dc3545'
};

const IN_FLIGHT_LABELS = {
  dialing: 'Dialing…',
  connected: 'Connected — talking to supplier',
  wrapping_up: 'Wrapping up…'
};

const RETRYABLE_STATUSES = ['failed', 'cancelled', 'rejected'];

function isInFlight(task) {
  return task.status === 'approved' && task.call && IN_FLIGHT_LABELS[task.call.status];
}

function canRetry(task) {
  if (RETRYABLE_STATUSES.includes(task.status)) return true;
  return task.status === 'completed' && task.outcome && task.outcome.next_action === 'retry_call';
}

// TaskCard owns only the local text-draft state for its own plan/retry form — every
// actual state change still goes through the dashboard's single onInvoke, which is the
// same /api/invoke chokepoint every agent tool call uses.
function TaskCard({ task, onInvoke, loading }) {
  const [draftGoal, setDraftGoal] = useState((task.plan && task.plan.goal) || '');

  return (
    <div
      style={{
        padding: '15px',
        border: '1px solid #ddd',
        borderRadius: '4px',
        marginBottom: '10px',
        backgroundColor: '#fff'
      }}
    >
      <h3>{task.name}</h3>
      <p>
        <strong>SKU:</strong> {task.sku} | <strong>Qty:</strong> {task.quantity} |{' '}
        <strong>Deadline:</strong> {task.deliveryDeadline}
      </p>
      <p>
        <strong>Status:</strong>{' '}
        <span style={{ color: STATUS_COLORS[task.status] || '#333', fontWeight: 'bold' }}>{task.status}</span>
      </p>
      {task.suppliers && (
        <p>
          <strong>Suppliers:</strong> {task.suppliers.map((s) => s.name).join(', ')}
        </p>
      )}
      {task.plan && (
        <p style={{ fontStyle: 'italic', color: '#555' }}>
          <strong>Plan:</strong> {task.plan.goal}
        </p>
      )}

      {/* Planned but not yet approved: the ONLY place approve/reject appear. These call
          approve_task/reject_task directly — never update_task, never a tool. */}
      {task.status === 'planned' && (
        <div style={{ marginTop: '10px' }}>
          <button
            onClick={() => onInvoke('approve_task', { id: task.id })}
            disabled={loading}
            style={buttonStyle('#28a745')}
          >
            Approve
          </button>
          <button
            onClick={() => onInvoke('reject_task', { id: task.id, reason: 'Rejected from dashboard' })}
            disabled={loading}
            style={buttonStyle('#dc3545')}
          >
            Reject
          </button>
        </div>
      )}

      {/* Approved and dialing/connected/wrapping up: the in-flight strip + cancel. */}
      {isInFlight(task) && (
        <div style={{ marginTop: '10px' }}>
          <span
            style={{
              display: 'inline-block',
              padding: '4px 10px',
              borderRadius: '12px',
              backgroundColor: '#fff3cd',
              color: '#856404',
              marginRight: '10px'
            }}
          >
            {IN_FLIGHT_LABELS[task.call.status]}
          </span>
          <button onClick={() => onInvoke('cancel_call', { id: task.id })} disabled={loading} style={buttonStyle('#dc3545')}>
            Cancel Call
          </button>
        </div>
      )}

      {/* Approved and nothing dialed yet: lets the demo trigger the dial by hand — the
          same place_call an agent would call, refused the same way if not approved. */}
      {task.status === 'approved' && !task.call && (
        <button onClick={() => onInvoke('place_call', { id: task.id })} disabled={loading} style={buttonStyle('#007bff')}>
          Place Call
        </button>
      )}

      {/* Outcome card. */}
      {task.outcome && (
        <div
          style={{
            marginTop: '10px',
            padding: '10px',
            borderRadius: '4px',
            backgroundColor: '#f8f9fa',
            border: '1px solid #e9ecef'
          }}
        >
          <p style={{ margin: 0 }}>
            <strong>Outcome:</strong> {task.outcome.outcome}
          </p>
          <p style={{ margin: 0 }}>
            <strong>Summary:</strong> {task.outcome.summary}
          </p>
          <p style={{ margin: 0 }}>
            <strong>Next action:</strong> {task.outcome.next_action}
          </p>
        </div>
      )}

      {/* Retry with an edited plan — never approves; the retried task lands back on
          "planned" and needs the owner's Approve button again. */}
      {canRetry(task) && (
        <div style={{ marginTop: '10px' }}>
          <textarea
            value={draftGoal}
            onChange={(e) => setDraftGoal(e.target.value)}
            placeholder="Edit the goal for this retry…"
            rows={2}
            style={{ width: '100%', padding: '6px', marginBottom: '6px' }}
          />
          <button
            onClick={() => onInvoke('retry_with_plan', { id: task.id, goal: draftGoal })}
            disabled={loading || !draftGoal}
            style={buttonStyle('#6c757d')}
          >
            Retry with Edited Plan
          </button>
        </div>
      )}

      {/* Pending, unplanned: quick-fill a plan so the demo can move a task forward
          without a separate agent process running. */}
      {task.status === 'pending' && (
        <button
          onClick={() =>
            onInvoke('plan_call', {
              id: task.id,
              goal: `Get a quote for ${task.sku} (qty ${task.quantity})`,
              script_points: ['Introduce as a procurement agent', 'Ask unit price, lead time, and MOQ'],
              success_criteria: 'Price, lead time, and MOQ captured',
              fallback: 'Leave a voicemail with a callback number'
            })
          }
          disabled={loading}
          style={buttonStyle('#17a2b8')}
        >
          Plan Call
        </button>
      )}
    </div>
  );
}

function buttonStyle(backgroundColor) {
  return {
    padding: '8px 16px',
    backgroundColor,
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    marginRight: '8px',
    marginTop: '4px'
  };
}

export default function Dashboard() {
  const [state, setState] = useState(null);
  const [activityLog, setActivityLog] = useState([]);
  const [newTask, setNewTask] = useState({
    name: '',
    sku: '',
    quantity: 0,
    deliveryDeadline: ''
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 1000);
    return () => clearInterval(interval);
  }, []);

  async function fetchState() {
    try {
      const res = await fetch('/api/state');
      const data = await res.json();
      setState(data);

      const actRes = await fetch('/api/activity-log');
      const actData = await actRes.json();
      setActivityLog(actData);
    } catch (error) {
      console.error('Error fetching state:', error);
    }
  }

  // The one function every button in this dashboard calls — the owner's half of the
  // shared /api/invoke chokepoint every agent tool call also goes through.
  async function handleInvoke(tool, args) {
    setLoading(true);
    try {
      const res = await fetch('/api/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool, args, actor: 'owner' })
      });
      await res.json();
      await fetchState();
    } catch (error) {
      console.error('Error invoking tool:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateTask(e) {
    e.preventDefault();
    if (!newTask.name) return;
    await handleInvoke('create_task', newTask);
    setNewTask({ name: '', sku: '', quantity: 0, deliveryDeadline: '' });
  }

  if (!state) {
    return <div style={{ padding: '20px' }}>Loading...</div>;
  }

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>CALL-E Supplier Quote Agent Dashboard</h1>

      <section style={{ marginBottom: '40px', padding: '20px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
        <h2>Create New Quote Request</h2>
        <form onSubmit={handleCreateTask}>
          <div style={{ marginBottom: '10px' }}>
            <input
              type="text"
              placeholder="Request name"
              value={newTask.name}
              onChange={(e) => setNewTask({ ...newTask, name: e.target.value })}
              style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
            />
          </div>
          <div style={{ marginBottom: '10px' }}>
            <input
              type="text"
              placeholder="SKU"
              value={newTask.sku}
              onChange={(e) => setNewTask({ ...newTask, sku: e.target.value })}
              style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
            />
          </div>
          <div style={{ marginBottom: '10px' }}>
            <input
              type="number"
              placeholder="Quantity"
              value={newTask.quantity}
              onChange={(e) => setNewTask({ ...newTask, quantity: parseInt(e.target.value) })}
              style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
            />
          </div>
          <div style={{ marginBottom: '10px' }}>
            <input
              type="date"
              value={newTask.deliveryDeadline}
              onChange={(e) => setNewTask({ ...newTask, deliveryDeadline: e.target.value })}
              style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '10px 20px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Create Request
          </button>
        </form>
      </section>

      <section style={{ marginBottom: '40px' }}>
        <h2>Active Quote Requests ({state.tasks.length})</h2>
        <div>
          {state.tasks.map((task) => (
            <TaskCard key={task.id} task={task} onInvoke={handleInvoke} loading={loading} />
          ))}
        </div>
      </section>

      <section style={{ marginBottom: '40px' }}>
        <h2>Quotes ({state.quotes.length})</h2>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            marginBottom: '20px'
          }}
        >
          <thead>
            <tr style={{ backgroundColor: '#f0f0f0' }}>
              <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Supplier</th>
              <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>SKU</th>
              <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Unit Price</th>
              <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Lead Time</th>
              <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {state.quotes
              .sort((a, b) => (a.price_per_unit || 0) - (b.price_per_unit || 0))
              .map((quote) => (
                <tr key={quote.quote_id}>
                  <td style={{ padding: '10px', borderBottom: '1px solid #ddd' }}>{quote.supplier_name}</td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #ddd' }}>{quote.sku}</td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #ddd' }}>${quote.price_per_unit?.toFixed(2)}</td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #ddd' }}>{quote.lead_time_days} days</td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #ddd' }}>{quote.status || 'completed'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Activity Log ({activityLog.length})</h2>
        <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #ddd', padding: '10px' }}>
          {activityLog.length === 0 ? (
            <p>No activity yet</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {activityLog
                .slice()
                .reverse()
                .map((entry, idx) => (
                  <li
                    key={idx}
                    style={{
                      padding: '8px',
                      borderBottom: '1px solid #eee',
                      fontSize: '0.9em'
                    }}
                  >
                    <strong>{entry.actor}</strong> called <code>{entry.tool}</code> at {new Date(entry.timestamp).toLocaleTimeString()}
                  </li>
                ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

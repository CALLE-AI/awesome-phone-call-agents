import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = 'http://localhost:5000/api';

const NAV = [
  ['dashboard', 'Dashboard', '⌂'],
  ['employees', 'Employees', '♙'],
  ['customers', 'Customers', '♧'],
  ['software', 'SaaS Optimizer', '▣'],
  ['policies', 'Policies', '▤'],
  ['meetings', 'Meetings', '□'],
  ['memos', 'Memos', '▱'],
  ['calls', 'Call Logs', '◔'],
  ['analytics', 'Analytics', '⌁'],
  ['settings', 'Settings', '⚙'],
];

const policyLabels = {
  employee: 'Employee Policy',
  customer: 'Customer Policy',
  marketing: 'Marketing Policy',
  vendor: 'Software / Vendor Policy',
};

const actLabels = {
  checkin: 'Employee check-in',
  offboard: 'Employee offboarding',
  renewal: 'Customer renewal',
  plan: 'Plan information',
  issue: 'Issue follow-up',
  feedback: 'Feedback call',
  'usage-review': 'Software renewal review',
  'seat-reclaim': 'Seat reclaim',
  'meeting-reminder': 'Meeting reminder',
  'memo': 'Memo delivery',
};

function App() {
  const [auth, setAuth] = useState(false);
  const [state, setState] = useState(null);
  const [tab, setTab] = useState('dashboard');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [range, setRange] = useState('This week');
  const [notifications, setNotifications] = useState(false);
  const [automation, setAutomation] = useState(null);
  const [autoRunning, setAutoRunning] = useState(false);

  const load = async () => {
    try {
      const r = await fetch(`${API}/state`);
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'Unable to load state');
      setState(d);
      setError('');
    } catch (e) {
      setError('Backend unavailable. Start Flask on port 5000.');
    }
  };

  const loadAutomation = async () => {
    try {
      const r = await fetch(`${API}/automation/status`);
      const d = await r.json();
      if (r.ok) setAutomation(d);
    } catch (e) { /* keep last known status rather than erroring the whole page */ }
  };

  useEffect(() => { if (auth) { load(); loadAutomation(); } }, [auth]);

  // Automation runs with nobody watching — poll so the dashboard reflects
  // what it's done on its own instead of requiring a manual refresh.
  useEffect(() => {
    if (!auth) return undefined;
    const id = window.setInterval(() => { load(); loadAutomation(); }, 6000);
    return () => window.clearInterval(id);
  }, [auth]);

  async function runAutomationNow() {
    setAutoRunning(true);
    try {
      const r = await fetch(`${API}/automation/run-once`, { method: 'POST' });
      const d = await r.json();
      if (r.ok) { setAutomation(d.status); await load(); }
    } finally { setAutoRunning(false); }
  }

  // Keep every hook unconditional: React requires hooks to run in the same
  // order on every render. This also makes the search model safe while the
  // initial API request is still loading.
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !state) return [];
    const rows = [
      ...(state.employees || []).map(x => ({ type: 'Employee', name: x.name, meta: `${x.role} · ${x.dept}`, tab: 'employees' })),
      ...(state.customers || []).map(x => ({ type: 'Customer', name: x.name, meta: x.customer_company, tab: 'customers' })),
      ...(state.licenses || []).map(x => ({ type: 'Software', name: x.tool, meta: `${x.dept} · ${x.owner}`, tab: 'software' })),
      ...(state.memos || []).map(x => ({ type: 'Memo', name: x.title, meta: x.status, tab: 'memos' })),
      ...(state.meetings || []).map(x => ({ type: 'Meeting', name: x.title, meta: x.time, tab: 'meetings' })),
    ];
    return rows.filter(x => `${x.name} ${x.meta || ''}`.toLowerCase().includes(q)).slice(0, 7);
  }, [query, state]);

  if (!auth) return <Login onLogin={() => setAuth(true)} />;
  if (!state) return <div className="loadingScreen"><div className="spinner" />Loading Relay…</div>;

  const logout = () => { setAuth(false); setState(null); };
  const currentNav = NAV.find(x => x[0] === tab);
  const departments = [...new Set((state.employees || []).map(e => e.dept).filter(Boolean))].sort();

  async function call(pillar, entity, act) {
    setError('');
    try {
      const r = await fetch(`${API}/trigger-call`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pillar, entityId: entity.id, act }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Call failed');
      setState(await (await fetch(`${API}/state`)).json());
      setNotifications(true);
      window.setTimeout(() => setNotifications(false), 2800);
    } catch (e) { setError(e.message); }
  }

  async function post(pillar, data) {
    const r = await fetch(`${API}/entities/${pillar}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Save failed');
    await load();
  }

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brandBlock">
  <img
    src="/relay-icon.png"
    alt="Relay"
    className="relayIcon"
  />

  <div>
    <div className="brandName">Relay</div>
    <div className="brandTag">Your Business, Optimized.</div>
  </div>
</div>

        <nav className="sideNav">
          <div className="navLabel">WORKSPACE</div>
          {NAV.map(([key, label, glyph]) => (
            <button key={key} className={`navItem ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
              <span className="navIcon">{glyph}</span><span>{label}</span>
              {key === 'calls' && state.call_logs.length > 0 && <span className="navBadge">{Math.min(state.call_logs.length, 99)}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebarBottom">
          <div className={`connection ${state.dry_run ? 'dry' : ''}`}><span className="liveDot" />{state.dry_run ? 'CALL-E · DRY RUN' : 'CALL-E · LIVE'}</div>
          <div className="workspaceCard">
            <div className="workspaceIcon">▥</div>
            <div><strong>{state.company?.name || 'Company'}</strong><small>{state.company?.email}</small></div>
            <span className="chevron">⌄</span>
          </div>
          <div className="userRow"><div className="avatar">AK</div><div><strong>Alex Kim</strong><small>Administrator</small></div><button onClick={logout} title="Sign out">↪</button></div>
        </div>
      </aside>

      <main className="mainArea">
        <header className="topHeader">
          <div className="searchWrap">
            <span className="searchIcon">⌕</span>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search employees, customers, software..." />
            {query && <button className="clearSearch" onClick={() => setQuery('')}>×</button>}
            {searchResults.length > 0 && <div className="searchResults">{searchResults.map((r, i) => <button key={`${r.name}-${i}`} onClick={() => { setTab(r.tab); setQuery(''); }}><span className="resultType">{r.type}</span><span><b>{r.name}</b><small>{r.meta}</small></span></button>)}</div>}
          </div>
          <div className="headerTools">
            <select value={range} onChange={e => setRange(e.target.value)}><option>Today</option><option>This week</option><option>This month</option></select>
            <button className="iconButton" onClick={() => setNotifications(!notifications)} aria-label="Notifications">♧</button>
            <div className="avatar headerAvatar">AK</div>
          </div>
        </header>

        {error && <div className="toast errorToast">{error}<button onClick={() => setError('')}>×</button></div>}
        {notifications && <div className="toast successToast">Action completed and business data updated.</div>}
        <AutomationBar automation={automation} onRunNow={runAutomationNow} running={autoRunning} />

        <div className="pageArea">
          {tab === 'dashboard' && <Dashboard state={state} go={setTab} onCall={call} range={range} />}
          {tab === 'employees' && <Employees items={state.employees} onCall={call} />}
          {tab === 'customers' && <Customers items={state.customers} onCall={call} />}
          {tab === 'software' && <Software items={state.licenses} onCall={call} onAdd={x => post('license', x)} />}
          {tab === 'policies' && <Policies policies={state.policies} meta={state.policy_meta} onSaved={load} />}
          {tab === 'meetings' && <Meetings items={state.meetings} departments={departments} onSaved={load} />}
          {tab === 'memos' && <Memos items={state.memos} departments={departments} onSaved={load} />}
          {tab === 'calls' && <Calls logs={state.call_logs} />}
          {tab === 'analytics' && <Analytics state={state} />}
          {tab === 'settings' && <Settings settings={state.settings} onSaved={load} />}
        </div>
      </main>
    </div>
  );
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('admin@relaydemo.com');
  const [password, setPassword] = useState('demo123');
  const [error, setError] = useState('');
  const [newCo, setNewCo] = useState(false);
  const [name, setName] = useState('');
  const submit = async e => {
    e.preventDefault(); setError('');
    const url = newCo ? `${API}/company` : `${API}/login`;
    const body = newCo ? { name, email, password } : { email, password };
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error);
      onLogin();
    } catch (e) { setError(e.message); }
  };
  return <div className="loginPage">
    <div className="loginGlow" />
    <div className="loginCard">
    <div className="loginBrand">
    <img
      src="/relay-logo.png"
      alt="Relay"
      className="loginLogo"
    />
    <div className="brandTag">Your Business, Optimized.</div>
    </div>
    <div className="eyebrow">COMPANY WORKSPACE</div><h1>{newCo ? 'Create your workspace' : 'Welcome back'}</h1><p>Connect your people, customers, policies and software spend to proactive AI operations.</p>
    <form onSubmit={submit}>{newCo && <input placeholder="Company name" value={name} onChange={e => setName(e.target.value)} required />}<input type="email" placeholder="Company email" value={email} onChange={e => setEmail(e.target.value)} required /><input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required /><button className="primary full">{newCo ? 'Create workspace' : 'Sign in'}</button></form>
    {error && <div className="inlineError">{error}</div>}<button className="textButton" onClick={() => setNewCo(!newCo)}>{newCo ? 'Use demo sign in' : 'Create a company instead'}</button>{!newCo && <div className="demoCreds">Demo workspace <b>admin@relaydemo.com</b><span>/</span><b>demo123</b></div>}
  </div></div>;
}

function Dashboard({ state, go, onCall }) {
  const e=state.employees||[], c=state.customers||[], l=state.licenses||[];
  const count=k=>e.filter(x=>x.attendance_status===k).length;
  const present=count('present'), absent=count('absent'), total=e.length;
  const todayKey=localDateKey(new Date());
  const callsToday=(state.call_logs||[]).filter(x=>(x.created_at||'').slice(0,10)===todayKey).length || state.call_logs.length;
  const spend=l.reduce((s,x)=>s+Number(x.seats_purchased||0)*Number(x.cost_per_seat||0),0);
  const unused=l.reduce((s,x)=>s+Math.max(0,Number(x.seats_purchased||0)-Number(x.seats_active||0))*Number(x.cost_per_seat||0),0);
  const renewals=c.filter(x=>x.renewal_date && daysUntil(x.renewal_date)>=0 && daysUntil(x.renewal_date)<=30).length;
  const attention=e.filter(x=>x.flag || ['absent','late','unknown','not_checked_in'].includes(x.attendance_status));
  return <div className="dashboard">
    <div className="dashboardHeading"><div><div className="eyebrow">COMPANY OVERVIEW</div><h1>Today’s overview</h1><p>Operational visibility across people, customers and software.</p></div><div className="headingMeta"><span className="statusIndicator"><i/> Relay is active</span><span className="timeChip">{state.server_time}</span></div></div>

    <section className="kpiGrid fiveKpis">
      <Kpi title="Present" value={present} note={`${Math.round(present/Math.max(total,1)*100)}% of the team`} icon="●" tone="green"/>
      <Kpi title="Absent" value={absent} note={`${attention.length} employees need attention`} icon="!" tone="red"/>
      <Kpi title="Total" value={total} note="Employees in workspace" icon="○" tone="purple"/>
      <Kpi title="Calls Today" value={callsToday} note={`${state.call_logs.filter(x=>x.status==='completed').length} completed`} icon="⌕" tone="purple"/>
      <Kpi title="SaaS Spend" value={`$${spend.toLocaleString()}`} note={`${l.length} tracked subscriptions`} icon="▣" tone="purple" chart/>
    </section>

    <section className="homeGrid">
      <Panel title="Meetings" subtitle="Today + the next four days · 10 AM–5 PM" action={<button className="panelLink" onClick={()=>go('meetings')}>View all</button>} className="meetingsLarge">
        <MeetingHeatmap meetings={state.meetings||[]}/>
      </Panel>
      <Panel title="Memos" subtitle={`${state.memos.length} active`} action={<button className="panelLink" onClick={()=>go('memos')}>View all</button>} className="memosPanel">
        <MemoPreview memos={state.memos}/>
      </Panel>
      <Panel title="Renewals" subtitle="Next 30 days" action={<button className="panelLink" onClick={()=>go('customers')}>View all</button>} className="renewalsPanel">
        <div className="renewalBig">{renewals}<small>customer renewals</small></div>
        <div className="renewalRows">{c.filter(x=>x.renewal_date).sort((a,b)=>a.renewal_date.localeCompare(b.renewal_date)).slice(0,3).map(x=><div key={x.id}><span>{x.name}</span><b>{daysUntil(x.renewal_date)}d</b></div>)}</div>
      </Panel>
      <Panel title="Unused Spend" subtitle="Optimization opportunity" action={<button className="panelLink" onClick={()=>go('software')}>Review</button>} className="unusedPanel">
        <div className="unusedHero"><strong>${unused.toLocaleString()}<small>/mo</small></strong><span>Potential monthly savings across underused subscriptions.</span></div>
        <MiniBars items={l.slice(0,8).map(x=>({name:x.tool,value:Math.max(0,x.seats_purchased-x.seats_active)*x.cost_per_seat}))}/>
      </Panel>
    </section>

    <section className="homeLower">
      <Panel title="Needs attention" subtitle="Recommended next actions"><div className="attentionList">{attention.slice(0,5).map(x=><div className="attentionItem" key={x.id}><div className={`attentionIcon ${x.attendance_status==='absent'?'red':'purple'}`}>!</div><div><b>{x.name}</b><small>{x.flag||'No check-in'} · {x.dept}</small></div><button onClick={()=>onCall('employee',x,'checkin')}>Call now</button></div>)}{!attention.length&&<Empty text="Everything looks clear."/>}</div></Panel>
      <Panel title="Software optimization" subtitle="Highest-value opportunities"><div className="optimizationRows">{l.sort((a,b)=>(b.seats_purchased-b.seats_active)*b.cost_per_seat-(a.seats_purchased-a.seats_active)*a.cost_per_seat).slice(0,4).map(x=>{const us=Math.max(0,x.seats_purchased-x.seats_active)*x.cost_per_seat; return <div key={x.id}><div><b>{x.tool}</b><small>{x.seats_active}/{x.seats_purchased} active · {x.optimization_status==='optimized'?'Optimized':'Needs review'}</small></div><strong>${us}/mo</strong></div>})}</div></Panel>
    </section>
  </div>;
}

function Employees({ items, onCall }) {
  const [filter, setFilter] = useState('All');
  const filtered = items.filter(e => filter === 'All' || (filter === 'Attention' ? !!e.flag || ['absent','late','unknown','not_checked_in'].includes(e.attendance_status) : e.attendance_status === filter.toLowerCase().replace(' ', '_')));
  return <Page title="Employees" sub="Attendance, people operations, offboarding and proactive check-ins." actions={<div className="filterGroup">{['All','Attention','Present','Remote','Late','Leave'].map(x => <button key={x} className={filter === x ? 'selected' : ''} onClick={() => setFilter(x)}>{x}</button>)}</div>}>
    <div className="sectionKpis"><SmallStat label="Present" value={items.filter(x => x.attendance_status === 'present').length} tone="green"/><SmallStat label="Absent" value={items.filter(x => x.attendance_status === 'absent').length} tone="red"/><SmallStat label="Late" value={items.filter(x => x.attendance_status === 'late').length} tone="yellow"/><SmallStat label="Remote" value={items.filter(x => x.attendance_status === 'remote').length} tone="purple"/><SmallStat label="Needs check-in" value={items.filter(x => ['unknown','not_checked_in'].includes(x.attendance_status)).length} tone="purple"/></div>
    <div className="entityGrid">{filtered.map(e => <div className="entityCard" key={e.id}><div className="entityHeader"><div className="person"><div className="avatar personAvatar">{initials(e.name)}</div><div><h3>{e.name}</h3><small>{e.role} · {e.dept}</small></div></div><Status value={e.attendance_status}/></div><div className="entityFacts"><Fact label="Assigned software" value={(e.assigned_software || []).join(', ') || '—'}/><Fact label="Upcoming meetings" value={e.upcoming_meetings || 'None'}/><Fact label="Phone" value={maskPhone(e.phone)}/><Fact label="Flag" value={e.flag || 'Clear'} warning={!!e.flag}/></div>{e.note && <p className="entityNote">{e.note}</p>}<div className="entityActions"><button className="primary small" onClick={() => onCall('employee', e, 'checkin')}>Call employee</button>{(e.offboarding_status === 'pending' || e.flag === 'Offboarding today') && <button onClick={() => onCall('employee', e, 'offboard')}>Offboarding call</button>}</div></div>)}</div>
  </Page>;
}

function Customers({ items, onCall }) {
  return <Page title="Customers" sub="Customer lifecycle, renewals and service conversations."><div className="sectionKpis"><SmallStat label="Total customers" value={items.length}/><SmallStat label="Active" value={items.filter(x => x.customer_status === 'Active').length} tone="green"/><SmallStat label="At risk" value={items.filter(x => x.customer_status === 'At risk').length} tone="red"/><SmallStat label="Renewals soon" value={items.filter(x => daysUntil(x.renewal_date) <= 7).length} tone="purple"/></div><div className="entityGrid">{items.map(c => <div className="entityCard" key={c.id}><div className="entityHeader"><div><div className="eyebrow">CUSTOMER ACCOUNT</div><h3>{c.name}</h3><small>{c.customer_company || 'Customer account'}</small></div><span className={`statusPill ${c.customer_status === 'At risk' ? 'red' : 'green'}`}>{c.customer_status}</span></div><div className="customerPlan"><strong>{c.plan}</strong><span>Current plan</span></div><div className="entityFacts"><Fact label="Renewal" value={`${c.renewal_date} · ${Math.max(daysUntil(c.renewal_date), 0)}d`}/><Fact label="Usage" value={c.usage}/><Fact label="Contact" value={maskPhone(c.phone)}/><Fact label="Recent issue" value={c.recent_issue || 'None'}/></div><div className="entityNote">{c.note}</div><div className="entityActions"><button className="primary small" onClick={() => onCall('customer', c, 'renewal')}>Renewal call</button><button onClick={() => onCall('customer', c, 'plan')}>Plan info</button><button onClick={() => onCall('customer', c, 'issue')}>Issue follow-up</button><button onClick={() => onCall('customer', c, 'feedback')}>Feedback</button></div></div>)}</div></Page>;
}

function Software({ items, onCall, onAdd }) {
  const [show, setShow] = useState(false); const [onlyLow, setOnlyLow] = useState(false);
  const spend = items.reduce((s,x) => s + x.seats_purchased*x.cost_per_seat, 0), unused = items.reduce((s,x) => s + Math.max(0,x.seats_purchased-x.seats_active)*x.cost_per_seat, 0);
  const filtered = onlyLow ? items.filter(x => x.seats_active / Math.max(x.seats_purchased,1) < .5) : items;
  return <Page title="SaaS Optimizer" sub="Optimize software utilization, renewals and unused business spend." actions={<div className="pageActions"><button className={onlyLow ? 'filterButton active' : 'filterButton'} onClick={() => setOnlyLow(!onlyLow)}>Low utilization</button><button className="primary" onClick={() => setShow(!show)}>+ Add software</button></div>}>
    <div className="sectionKpis"><SmallStat label="Monthly spend" value={`$${spend.toLocaleString()}`} tone="purple"/><SmallStat label="Potential unused" value={`$${unused.toLocaleString()}`} tone="yellow"/><SmallStat label="Purchased seats" value={items.reduce((s,x)=>s+x.seats_purchased,0)}/><SmallStat label="Active seats" value={items.reduce((s,x)=>s+x.seats_active,0)} tone="green"/></div>
    {show && <SoftwareForm onAdd={async x => { await onAdd(x); setShow(false); }} />}
    <div className="sectionTitle"><div><div className="eyebrow">SOFTWARE INVENTORY</div><h2>Subscriptions</h2></div><span>{filtered.length} of {items.length} shown</span></div>
    <div className="softwareGrid">{filtered.map(x => { const unusedSeats = Math.max(0,x.seats_purchased-x.seats_active), unusedSpend = unusedSeats*x.cost_per_seat, util = x.seats_purchased ? Math.round(x.seats_active/x.seats_purchased*100) : 0; return <div className="softwareCardDark" key={x.id}><div className="softwareHeader"><div className="toolLogo">{x.tool.slice(0,1)}</div><div><h3>{x.tool}</h3><small>{x.dept} · Owner: {x.owner}</small></div><span className={`utilPill ${util < 50 ? 'danger' : 'good'}`}>{util}%</span></div><div className="utilBar"><i style={{width:`${Math.min(util,100)}%`}} /></div><div className="softwareStats"><div><b>{x.seats_purchased}</b><span>Seats</span></div><div><b>{x.seats_active}</b><span>Active</span></div><div><b>${x.cost_per_seat}</b><span>Per seat</span></div><div><b>${x.seats_purchased*x.cost_per_seat}</b><span>Monthly</span></div></div><div className="renewalRow"><div><span>Renewal</span><b>{x.renewal_date}</b><small>{Math.max(daysUntil(x.renewal_date),0)} days</small></div><div className="unusedSpend"><span>Potential unused</span><b>${unusedSpend}/mo</b></div></div>{x.flag && <div className="flagBanner">⚠ {x.flag}</div>}<button className="primary full small" disabled={x.optimization_status==='optimized'} onClick={() => onCall('license', x, 'usage-review')}>{x.optimization_status==='optimized'?'✓ Optimized':'Review & optimize'}</button></div> })}</div>
  </Page>;
}

function SoftwareForm({ onAdd }) { const [x,setX]=useState({tool:'',dept:'',owner:'',owner_phone:'',seats_purchased:10,seats_active:5,cost_per_seat:10,renewal_date:'2026-12-31'}); return <div className="darkForm"><div className="eyebrow">ADD SUBSCRIPTION</div><h3>Track a software product</h3><div className="formGrid">{['tool','dept','owner','owner_phone','renewal_date'].map(k=><input key={k} placeholder={k.replaceAll('_',' ')} value={x[k]} onChange={e=>setX({...x,[k]:e.target.value})}/>)}<input type="number" placeholder="seats purchased" value={x.seats_purchased} onChange={e=>setX({...x,seats_purchased:+e.target.value})}/><input type="number" placeholder="active seats" value={x.seats_active} onChange={e=>setX({...x,seats_active:+e.target.value})}/><input type="number" placeholder="cost per seat" value={x.cost_per_seat} onChange={e=>setX({...x,cost_per_seat:+e.target.value})}/></div><button className="primary" onClick={() => onAdd(x)}>Save software</button></div>; }

function Policies({ policies, meta, onSaved }) { const [local,setLocal]=useState(policies); const [saving,setSaving]=useState(''); const upload=async(k,file)=>{const fd=new FormData();fd.append('key',k);fd.append('file',file);const r=await fetch(`${API}/policies/upload`,{method:'POST',body:fd});if(!r.ok)throw Error((await r.json()).error);onSaved();}; const save=async k=>{setSaving(k);await fetch(`${API}/policies/${k}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:local[k]})});setSaving('');onSaved();}; return <Page title="Company Policies" sub="Business-specific guardrails that Relay uses during conversations and actions."><div className="policyHero"><div className="policyHeroIcon">▤</div><div><strong>Policies power Relay's decisions</strong><p>Upload or edit the rules your agents should follow. The supplied demo policies are already loaded.</p></div></div><div className="policyGrid">{Object.entries(policies).map(([k,v])=><div className="policyCard" key={k}><div className="policyHeader"><div><div className="eyebrow">{k.toUpperCase()}</div><h3>{policyLabels[k]||k}</h3><small>{meta[k]?.filename || 'Not uploaded'} · updated {meta[k]?.updated_at || '—'}</small></div><label className="uploadButton">Upload<input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={e=>e.target.files[0]&&upload(k,e.target.files[0])}/></label></div><textarea value={local[k]} onChange={e=>setLocal({...local,[k]:e.target.value})}/><button onClick={()=>save(k)}>{saving===k?'Saving…':'Save policy'}</button></div>)}</div></Page>; }

function Meetings({ items, departments, onSaved }) {
  const [show,setShow]=useState(false), [saving,setSaving]=useState(false);
  const [x,setX]=useState({title:'',date:localDateKey(new Date()),time:'10:00',dept:departments[0]||''});
  const save=async()=>{setSaving(true);try{const r=await fetch(`${API}/meetings/schedule`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...x})});const d=await r.json();if(!r.ok)throw Error(d.error||'Unable to schedule meeting');onSaved();setShow(false);}catch(e){alert(e.message)}finally{setSaving(false)}};
  return <Page title="Meetings" sub="Schedule meetings by department and have Relay call the people who need the reminder." actions={<button className="primary" onClick={()=>setShow(!show)}>+ Schedule meeting</button>}>
    {show&&<div className="darkForm"><div className="eyebrow">NEW MEETING</div><h3>Schedule & notify a department</h3><div className="formGrid"><input placeholder="Meeting title" value={x.title} onChange={e=>setX({...x,title:e.target.value})}/><input type="date" value={x.date} onChange={e=>setX({...x,date:e.target.value})}/><input type="time" value={x.time} onChange={e=>setX({...x,time:e.target.value})}/><select value={x.dept} onChange={e=>setX({...x,dept:e.target.value})}>{departments.map(d=><option key={d}>{d}</option>)}</select></div><p className="formHint">Relay will call every employee in the selected department with a meeting reminder.</p><button className="primary" disabled={saving} onClick={save}>{saving?'Calling attendees…':'Schedule & call attendees'}</button></div>}
    <div className="meetingPageGrid">{items.slice().sort((a,b)=>`${a.date||''}${a.time}`.localeCompare(`${b.date||''}${b.time}`)).map(m=><div className="meetingCard" key={m.id}><div className="meetingTime"><b>{m.time}</b><span>{m.date||'Scheduled'}</span></div><div><div className="eyebrow">{m.dept||m.owner||'Company'}</div><h3>{m.title}</h3><p>{m.recipient_ids?.length||0} employees notified · {m.reminder_status||'Scheduled'}</p></div><span className={`meetingStatus ${m.reminder_status==='completed'?'done':''}`}>{m.reminder_status==='completed'?'Reminders sent':'Scheduled'}</span></div>)}</div>
  </Page>;
}

function Memos({ items, departments, onSaved }) {
  const [show,setShow]=useState(false), [saving,setSaving]=useState(false);
  const [x,setX]=useState({title:'',body:'',dept:departments[0]||'',status:'open'});
  const save=async()=>{setSaving(true);try{const r=await fetch(`${API}/memos/publish`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(x)});const d=await r.json();if(!r.ok)throw Error(d.error||'Unable to publish memo');onSaved();setShow(false);}catch(e){alert(e.message)}finally{setSaving(false)}};
  return <Page title="Memos" sub="Publish department-specific updates and let Relay deliver them by phone." actions={<button className="primary" onClick={()=>setShow(!show)}>+ New memo</button>}>
    {show&&<div className="darkForm"><div className="eyebrow">NEW MEMO</div><h3>Create & notify a department</h3><div className="formGrid"><input placeholder="Memo title" value={x.title} onChange={e=>setX({...x,title:e.target.value})}/><select value={x.dept} onChange={e=>setX({...x,dept:e.target.value})}>{departments.map(d=><option key={d}>{d}</option>)}</select></div><textarea className="formTextarea" placeholder="Memo body" value={x.body} onChange={e=>setX({...x,body:e.target.value})}/><button className="primary" disabled={saving} onClick={save}>{saving?'Calling recipients…':'Publish & call recipients'}</button></div>}
    <div className="memoPageGrid">{items.map(m=><div className="memoCard" key={m.id}><div className="memoIcon">▤</div><div><div className="eyebrow">{m.dept||'COMPANY'}</div><h3>{m.title}</h3><p>{m.body}</p><small>{m.status} · {m.recipient_ids?.length||0} recipients · {m.delivery_status||'open'}</small></div></div>)}</div>
  </Page>;
}

function Calls({ logs }) { const [filter,setFilter]=useState('All'); const filtered=logs.filter(x=>filter==='All'||x.pillar===filter); return <Page title="Call Logs" sub="Every operational call, transcript, structured outcome and audit event in one place." actions={<div className="filterGroup">{['All','employee','customer','license'].map(x=><button key={x} className={filter===x?'selected':''} onClick={()=>setFilter(x)}>{x}</button>)}</div>}>{filtered.length?<div className="callList">{filtered.map(x=><div className="callCard" key={x.id}><div className="callHeader"><div><span className="callType">{actLabels[x.act]||x.act}</span><small>{x.pillar} · {x.entity_id} · {x.created_at}</small></div><span className={`statusPill ${x.status==='completed'?'green':'yellow'}`}>{x.status}</span></div><p>{x.summary}</p><details><summary>View transcript & structured result</summary><div className="transcript">{(x.transcript||[]).map((t,i)=><p key={i}><b>{t.speaker==='bot'?'Relay':'Recipient'}:</b> {t.text}</p>)}</div><pre>{JSON.stringify(x.structured_result,null,2)}</pre></details></div>)}</div>:<Empty text="No calls match this filter."/>}</Page>; }

function Analytics({ state }) { const [a,setA]=useState(null); useEffect(()=>{fetch(`${API}/analytics`).then(r=>r.json()).then(setA)},[state.call_logs.length,state.employees.length,state.licenses.length]); if(!a)return <Page title="Analytics" sub="Leadership-level visibility into operational efficiency."><div className="loadingBox">Calculating analytics…</div></Page>; const totalSeats=state.licenses.reduce((s,x)=>s+x.seats_purchased,0),activeSeats=state.licenses.reduce((s,x)=>s+x.seats_active,0),util=totalSeats?Math.round(activeSeats/totalSeats*100):0; return <Page title="Analytics" sub="Leadership-level visibility into operational efficiency and optimization opportunities."><div className="sectionKpis"><SmallStat label="Employee present" value={a.employee_status.present} tone="green"/><SmallStat label="Call completion" value={`${a.calls.total?Math.round(a.calls.completed/a.calls.total*100):0}%`} tone="purple"/><SmallStat label="SaaS utilization" value={`${util}%`} tone="purple"/><SmallStat label="Unused spend" value={`$${a.software.unused_monthly_spend.toLocaleString()}`} tone="yellow"/></div><div className="analyticsGrid"><ChartPanel title="Employee status" data={a.employee_status}/><ChartPanel title="Calls by pillar" data={a.calls.by_pillar}/><ChartPanel title="Customer plans" data={a.customer_plans}/></div><div className="insightBanner"><div><div className="eyebrow">OPTIMIZATION SIGNAL</div><h3>{util < 70 ? 'Software utilization is below target.' : 'Software utilization is healthy.'}</h3><p>Relay found <strong>${a.software.unused_monthly_spend.toLocaleString()}/month</strong> in potential unused SaaS spend.</p></div><span className="insightNumber">{util}%</span></div></Page>; }
function ChartPanel({ title, data }) { const max=Math.max(...Object.values(data),1); return <section className="chartPanel"><div className="panelTitle"><div><h3>{title}</h3><span>Current snapshot</span></div></div><div className="horizontalBars">{Object.entries(data).map(([k,v])=><div key={k}><div><span>{k.replaceAll('_',' ')}</span><b>{v}</b></div><i style={{width:`${v/max*100}%`}} /></div>)}</div></section>; }

function Settings({ settings, onSaved }) { const labels={meeting_scheduler:'Meeting scheduler',memo_broadcast:'Memo broadcasts',employee_operations:'Employee operations',customer_lifecycle:'Customer lifecycle',vendor_optimization:'Vendor / SaaS optimizer',automatic_followups:'Automatic follow-ups'}; const desc={meeting_scheduler:'Manage upcoming meetings and department reminder workflows.',memo_broadcast:'Allow Relay to deliver department-specific memos by phone.',employee_operations:'Enable employee check-ins, attendance and offboarding calls.',customer_lifecycle:'Enable customer renewal and service lifecycle calls.',vendor_optimization:'Enable software utilization and renewal optimization calls.',automatic_followups:'Allow future workflows to create follow-up tasks.'}; const change=async(k,v)=>{await fetch(`${API}/settings`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({[k]:v})});onSaved()}; return <Page title="Settings" sub="Control which Relay capabilities are active for this company."><div className="settingsLayout"><div className="settingsIntro"><div className="settingsIcon">⚙</div><div><div className="eyebrow">AUTOMATION CONTROL CENTER</div><h2>Choose what Relay can operate</h2><p>These switches are enforced by the backend for call workflows. Turn a capability off to prevent its corresponding actions.</p></div></div><div className="settingsList">{Object.entries(settings).map(([k,v])=><div className="settingRow" key={k}><div className="settingIcon">{k==='employee_operations'?'♙':k==='customer_lifecycle'?'♧':k==='vendor_optimization'?'▣':k==='meeting_scheduler'?'□':k==='memo_broadcast'?'▤':'⌁'}</div><div className="settingCopy"><b>{labels[k]||k}</b><small>{desc[k]||''}</small></div><label className="switch"><input type="checkbox" checked={v} onChange={e=>change(k,e.target.checked)}/><span /></label></div>)}</div></div></Page>; }

function MeetingHeatmap({ meetings }) {
  const base=new Date(); base.setHours(0,0,0,0);
  const days=Array.from({length:5},(_,i)=>{const d=new Date(base);d.setDate(base.getDate()+i);return d;});
  const hours=[10,11,12,13,14,15,16,17];
  const key=d=>localDateKey(d);
  const label=d=>d.toLocaleDateString(undefined,{weekday:'short',day:'numeric'});
  const count=(d,h)=>meetings.filter(m=>(m.date||'')===key(d)&&parseInt((m.time||'').split(':')[0],10)===h).length;
  return <div className="meetingHeatmap"><div className="heatHeader"><span>TIME</span>{days.map(d=><b key={key(d)} className={key(d)===key(base)?'today':''}>{label(d)}{key(d)===key(base)&&<em>Today</em>}</b>)}</div><div className="heatRows">{hours.map(h=><div className="heatLine" key={h}><span>{h<=12?`${h}am`:`${h-12}pm`}</span>{days.map(d=>{const n=count(d,h);return <i key={key(d)+h} className={`meetingCell i${Math.min(n,4)}`} title={`${n} meeting${n===1?'':'s'} · ${label(d)} · ${h}:00`}>{n||''}</i>})}</div>)}</div><div className="heatLegend"><span><i className="meetingCell i0"/>None</span><span><i className="meetingCell i1"/>1</span><span><i className="meetingCell i2"/>2</span><span><i className="meetingCell i3"/>3+</span></div></div>;
}

function MeetingPreview({ meetings }) { return <div className="previewList">{meetings.slice(0,4).map(m=><div className="meetingPreview" key={m.id}><time>{m.time}</time><div><b>{m.title}</b><small>{m.owner}</small></div><span>Scheduled</span></div>)}</div>; }
function MemoPreview({ memos }) { return <div className="previewList">{memos.slice(0,4).map(m=><div className="memoPreview" key={m.id}><div className="memoMiniIcon">▤</div><div><b>{m.title}</b><small>{m.dept||'Company'} · {m.status}</small></div></div>)}</div>; }
function MiniBars({ items }) { const max=Math.max(...items.map(x=>x.value),1); return <div className="miniBars">{items.map(x=><div className="miniBar" key={x.name} title={`${x.name}: $${x.value}`}><i style={{height:`${Math.max(18,x.value/max*100)}%`}} /><span>{x.name.split(' ')[0]}</span></div>)}</div>; }
function LineChart({ values, labels }) { const w=420,h=118,p=7; const max=Math.max(...values),min=Math.min(...values); const pts=values.map((v,i)=>`${p+i*(w-2*p)/(values.length-1)},${h-p-(v-min)/Math.max(max-min,1)*(h-2*p)}`).join(' '); const area=`${p},${h-p} ${pts} ${w-p},${h-p}`; return <div className="lineChart"><svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"><polygon points={area} className="chartArea"/><polyline points={pts} className="chartLine"/><circle cx={w-p} cy={h-p-(values.at(-1)-min)/Math.max(max-min,1)*(h-2*p)} r="3.5" className="chartDot"/></svg><div className="chartLabels">{labels.map(x=><span key={x}>{x}</span>)}</div></div>; }
function Page({ title, sub, children, actions }) { return <div className="page"><div className="pageTitle"><div><div className="eyebrow">RELAY WORKSPACE</div><h1>{title}</h1><p>{sub}</p></div>{actions && <div className="pageTitleActions">{actions}</div>}</div>{children}</div>; }
function Panel({ title, subtitle, action, children, className='' }) { return <section className={`panel ${className}`}><div className="panelTitle"><div><h3>{title}</h3>{subtitle && <span>{subtitle}</span>}</div>{action}</div>{children}</section>; }
function Kpi({ title, value, note, icon, tone, chart }) { return <div className="kpiCard"><div className="kpiTop"><span><i className={`kpiIcon ${tone}`}>{icon}</i>{title}</span><i className={`signal ${tone}`} /></div><strong>{value}</strong><small>{note}</small>{chart ? <MiniSpark /> : <div className={`kpiTrack ${tone}`}><i style={{width:`${Math.min(100, Number(value)||65)}%`}} /></div>}</div>; }
function MiniSpark(){return <div className="miniSpark">{[20,29,35,31,46,54,60,75,70,88,96].map((h,i)=><i key={i} style={{height:`${h}%`}} />)}</div>;}
function SmallStat({label,value,tone=''}){return <div className="smallStat"><span>{label}</span><strong className={tone}>{value}</strong></div>}
function maskPhone(phone) {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  return `••• ••• ${digits.slice(-4)}`;
}

function AutomationBar({ automation, onRunNow, running }) {
  const firedCount = automation?.last_result?.filter(f => f.callId).length ?? 0;
  const lastRun = automation?.last_run ? new Date(automation.last_run).toLocaleTimeString() : 'not yet';
  return (
    <div className="automationBar">
      <span className={`liveDot ${automation?.running ? '' : 'dim'}`} />
      <span>
        Automation checks every {automation?.interval_seconds ?? '…'}s on its own — nobody clicks
        "call" for this. Last check {lastRun}{automation?.last_run ? `, ${firedCount} call(s) placed` : ''}.
      </span>
      <button className="small" onClick={onRunNow} disabled={running}>{running ? 'Checking…' : 'Run check now'}</button>
    </div>
  );
}

function Fact({label,value,warning}){return <div><span>{label}</span><b className={warning?'warningText':''}>{value}</b></div>}
function Status({value}){const labels={present:'Present',absent:'Absent',late:'Late',remote:'Remote',leave:'On leave',unknown:'Not checked in',not_checked_in:'Not checked in'};return <span className={`statusPill ${value==='absent'||value==='unknown'||value==='not_checked_in'?'red':value==='late'?'yellow':value==='remote'?'purple':'green'}`}>{labels[value]||value}</span>}
function Empty({text}){return <div className="empty">{text}</div>}
function initials(name=''){return name.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();}
function localDateKey(d){const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');const day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`;}
function daysUntil(date){const t=new Date(date+'T00:00:00');const n=new Date();n.setHours(0,0,0,0);return Math.ceil((t-n)/86400000);}
function Loading(){return <div className="loadingBox">Loading…</div>}

createRoot(document.getElementById('root')).render(<App />);

import os, json, time
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from .db import init_db, get_state, entity, update_entity, upsert_entity, add_log, connect, now
from .tasks import build
from .calle import create_call, get_call, DRY_RUN
from .dry_run import simulate

load_dotenv(); init_db()
app=Flask(__name__, static_folder=None); CORS(app)

FEATURE_FOR = {'employee':'employee_operations','customer':'customer_lifecycle','license':'vendor_optimization'}

def public_company():
    s=get_state(); return s.get('company')

@app.post('/api/login')
def login():
    body=request.get_json() or {}; email=body.get('email','').strip().lower(); password=body.get('password','')
    conn=connect(); row=conn.execute('SELECT id,name,email FROM company WHERE lower(email)=? AND password=?',(email,password)).fetchone(); conn.close()
    if not row: return jsonify({'error':'Invalid company email or password'}),401
    return jsonify({'authenticated':True,'company':dict(row)})

@app.post('/api/company')
def create_company():
    body=request.get_json() or {}
    if not body.get('name') or not body.get('email') or not body.get('password'): return jsonify({'error':'name, email and password are required'}),400
    conn=connect()
    try:
        conn.execute('INSERT INTO company(id,name,email,password) VALUES(?,?,?,?)',(f"company_{int(time.time())}",body['name'],body['email'].lower(),body['password']))
        conn.commit()
    except Exception:
        conn.close(); return jsonify({'error':'A company with this email already exists'}),409
    conn.close(); return jsonify({'authenticated':True,'company':public_company()})

@app.get('/api/state')
def state(): return jsonify({'dry_run':DRY_RUN,'server_time':time.strftime('%Y-%m-%d %H:%M:%S'),**get_state()})

@app.get('/api/analytics')
def analytics():
    s=get_state(); employees=s['employees']; customers=s['customers']; licenses=s['licenses'];
    spend=sum(float(x.get('seats_purchased',0))*float(x.get('cost_per_seat',0)) for x in licenses)
    unused=sum(max(0,int(x.get('seats_purchased',0))-int(x.get('seats_active',0)))*float(x.get('cost_per_seat',0)) for x in licenses)
    return jsonify({'employee_status':{k:sum(1 for e in employees if e.get('attendance_status')==k) for k in ['present','absent','late','remote','leave']},'customer_plans':{p:sum(1 for c in customers if c.get('plan')==p) for p in sorted({c.get('plan') for c in customers})},'software':{'monthly_spend':spend,'unused_monthly_spend':unused,'utilization':(sum(int(x.get('seats_active',0)) for x in licenses)/sum(int(x.get('seats_purchased',0)) for x in licenses)*100) if sum(int(x.get('seats_purchased',0)) for x in licenses) else 0},'calls':{'total':len(s['call_logs']),'completed':sum(1 for x in s['call_logs'] if x['status']=='completed'),'by_pillar':{p:sum(1 for x in s['call_logs'] if x['pillar']==p) for p in ['employee','customer','license']}}})

@app.patch('/api/entities/<pillar>/<entity_id>')
def patch_entity(pillar,entity_id):
    data=request.get_json() or {}; updated=update_entity(pillar,entity_id,data)
    if not updated: return jsonify({'error':'entity not found'}),404
    add_log(pillar,f"{updated.get('name') or updated.get('tool')} updated manually")
    return jsonify(updated)

@app.post('/api/entities/<pillar>')
def add_entity(pillar):
    body=request.get_json() or {}
    if not body.get('id'): body['id']=f'{pillar[:2]}_{int(time.time()*1000)}'
    try: out=upsert_entity(pillar,body)
    except Exception as ex: return jsonify({'error':str(ex)}),400
    add_log(pillar,f"{body.get('name') or body.get('tool') or body.get('title')} added")
    return jsonify(out),201

@app.patch('/api/settings')
def settings():
    values=request.get_json() or {}; conn=connect()
    for k,v in values.items(): conn.execute('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(k,int(bool(v))))
    conn.commit(); conn.close(); return jsonify(get_state()['settings'])

@app.post('/api/policies/upload')
def upload_policy():
    file=request.files.get('file'); key=request.form.get('key','')
    if key not in ('employee','customer','marketing','vendor') or not file: return jsonify({'error':'Choose a policy and a text/markdown file'}),400
    raw=file.read()
    try: content=raw.decode('utf-8')
    except UnicodeDecodeError: return jsonify({'error':'For this demo, upload UTF-8 .txt or .md policies'}),400
    conn=connect(); conn.execute('INSERT INTO policies(key,content,filename,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET content=excluded.content,filename=excluded.filename,updated_at=excluded.updated_at',(key,content,file.filename,now())); conn.commit(); conn.close(); add_log('policy',f'{key} policy uploaded: {file.filename}'); return jsonify({'key':key,'filename':file.filename,'content':content})

@app.put('/api/policies/<key>')
def policy(key):
    if key not in ('employee','customer','marketing','vendor'): return jsonify({'error':'invalid policy'}),400
    content=(request.get_json() or {}).get('content',''); conn=connect(); conn.execute('INSERT INTO policies(key,content,filename,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at',(key,content,f'{key}-policy.md',now())); conn.commit(); conn.close(); add_log('policy',f'{key} policy updated'); return jsonify({'key':key,'content':content})

def save_call(call_id,pillar,entity_id,act,result,status,created,completed,dry):
    conn=connect(); conn.execute('INSERT OR REPLACE INTO call_logs(id,pillar,entity_id,act,status,summary,structured_result,transcript,dry_run,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(call_id,pillar,entity_id,act,status,result.get('summary'),json.dumps(result.get('structured_result')),json.dumps(result.get('transcript',[])),int(dry),created,completed)); conn.commit(); conn.close()

def apply_result(pillar,act,e,result):
    r=result.get('structured_result') or {}; updates={}
    if pillar=='employee' and act=='checkin':
        s=r.get('checkin_status'); mapping={'remote_today':'remote','on_leave':'leave','running_late':'late','forgot_to_checkin':'present','escalate':'absent'}
        updates={'checkin_status':s,'attendance_status':mapping.get(s,e.get('attendance_status')),'last_call_outcome':r.get('reason',''),'flag':None if s in ('remote_today','on_leave','forgot_to_checkin') else ('Escalation required' if s=='escalate' else e.get('flag'))}
    elif pillar=='employee' and act=='meeting-reminder':
        updates={'last_meeting_reminder':r.get('response',''),'last_meeting_reminder_status':r.get('attendance','unknown')}
    elif pillar=='employee' and act=='memo':
        updates={'last_memo_response':r.get('response',''),'last_memo_acknowledged':r.get('acknowledged','unknown')}
    elif pillar=='employee' and act=='offboard':
        updates={'offboarding_status':r.get('handoff_status'),'equipment_return':r.get('equipment_return'),'tool_access_confirmed':r.get('tool_access_confirmed'),'flag':None if r.get('handoff_status')=='confirmed' else 'Follow-up needed'}
    elif pillar=='customer' and act=='renewal':
        updates={'renewal_status':r.get('decision'),'last_call_reason':r.get('reason',''),'flag':None if r.get('decision') in ('renewed','downgraded','cancelled') else e.get('flag')}
        if r.get('plan_after_call'): updates['plan']=r['plan_after_call']
    elif pillar=='customer' and act=='issue': updates={'recent_issue_status':'resolved' if r.get('severity')=='low' else 'follow_up','last_issue_call':r.get('resolution'),'flag':None if r.get('escalated')=='no' else 'Escalated'}
    elif pillar=='customer' and act=='feedback': updates={'last_feedback':r.get('feedback'),'feedback_sentiment':r.get('sentiment'),'flag':None}
    elif pillar=='license':
        try: seats=int(r.get('seats_after_call',''))
        except: seats=None
        if seats is not None and seats>=0: updates['seats_purchased']=seats
        updates['last_call_decision']=r.get('decision'); updates['monthly_cost_after_call']=float(r.get('monthly_cost_after_call',0) or 0); updates['optimization_status']='optimized'; updates['optimized_at']=now(); updates['flag']=None if r.get('decision') in ('renew_as_is','downgrade','cancel') else e.get('flag')
    updated=update_entity(pillar,e['id'],updates) if updates else e
    if pillar=='employee' and act=='offboard' and r.get('handoff_status')=='confirmed':
        for lic in get_state()['licenses']:
            assigned=e.get('assigned_software',e.get('tools',[]))
            if lic['tool'] in assigned and lic['dept']==e['dept']:
                # Flag it as pending rather than silently decrementing the
                # seat count here — the actual reduction should come from a
                # real license:seat-reclaim call to the department head (see
                # tasks.py / dry_run.py), which is what the automation engine
                # (or a manual "Review & optimize" click) does next. This is
                # the difference between "the department head confirmed it"
                # and "the backend quietly changed a number."
                update_entity('license',lic['id'],{'flag':'Reclaim needed','_reclaim_reason':e['name']+' offboarding'})
                add_log('license',f"{lic['tool']} flagged for seat reclaim after {e['name']} offboarding — awaiting department head confirmation call",True)
                break
    return updated


def execute_call(pillar, entity_id, act, context=None):
    e=entity(pillar,entity_id)
    if not e: raise ValueError('entity not found')
    settings=get_state()['settings']; feature=FEATURE_FOR.get(pillar)
    if feature and not settings.get(feature,True): raise PermissionError(f'{feature.replace("_"," ").title()} is disabled in Settings')
    target_phone=e.get('phone') or e.get('owner_phone')
    if not target_phone: raise ValueError('entity has no phone number')
    call_entity=dict(e); call_entity['phone']=target_phone
    state=get_state(); task,schema=build(pillar,act,e,state['policies'],context)
    metadata={'pillar':pillar,'entityId':entity_id,'act':act}
    created=create_call(task,call_entity,schema,metadata); call_id=created['id']
    if DRY_RUN:
        result=simulate(pillar,act,e,context)
        save_call(call_id,pillar,entity_id,act,result,result['status'],result['created_at'],result['completed_at'],True)
        apply_result(pillar,act,e,result)
        add_log(pillar,f"{e.get('name') or e.get('tool')} — {result['summary']}")
        return {'callId':call_id,'dryRun':True,'call':result}
    save_call(call_id,pillar,entity_id,act,{'summary':'Call started','structured_result':None,'transcript':[]},created.get('status','queued'),now(),None,False)
    add_log(pillar,f"{e.get('name') or e.get('tool')} — call placed via CALL-E")
    return {'callId':call_id,'dryRun':False}

@app.post('/api/meetings/schedule')
def schedule_meeting():
    body=request.get_json() or {}
    title=body.get('title','').strip(); date=body.get('date',''); tm=body.get('time',''); dept=body.get('dept','').strip()
    if not title or not date or not tm or not dept: return jsonify({'error':'title, date, time and department are required'}),400
    settings=get_state()['settings']
    if not settings.get('meeting_scheduler',True): return jsonify({'error':'Meeting scheduler is disabled in Settings'}),403
    conn=connect(); employees=[json.loads(r['data']) for r in conn.execute('SELECT data FROM employees ORDER BY rowid') if json.loads(r['data']).get('dept')==dept]; conn.close()
    meeting={'id':body.get('id') or f'm_{int(time.time()*1000)}','title':title,'date':date,'time':tm,'dept':dept,'owner':dept,'recipient_ids':[e['id'] for e in employees],'reminder_calls':[],'reminder_status':'pending'}
    upsert_entity('meeting',meeting)
    errors=[]
    for e in employees:
        try: meeting['reminder_calls'].append(execute_call('employee',e['id'],'meeting-reminder',{'title':title,'date':date,'time':tm})['callId'])
        except Exception as ex: errors.append(f"{e['name']}: {ex}")
    meeting['reminder_status']='completed' if employees and not errors else ('no_recipients' if not employees else 'partial')
    upsert_entity('meeting',meeting)
    add_log('meeting',f"{title} scheduled for {dept}; called {len(employees)-len(errors)} of {len(employees)} employees")
    return jsonify({'meeting':meeting,'called':len(employees)-len(errors),'errors':errors}),201

@app.post('/api/memos/publish')
def publish_memo():
    body=request.get_json() or {}
    title=body.get('title','').strip(); memo_body=body.get('body','').strip(); dept=body.get('dept','').strip()
    if not title or not memo_body or not dept: return jsonify({'error':'title, body and department are required'}),400
    settings=get_state()['settings']
    if not settings.get('memo_broadcast',True): return jsonify({'error':'Memo broadcasts are disabled in Settings'}),403
    conn=connect(); employees=[json.loads(r['data']) for r in conn.execute('SELECT data FROM employees ORDER BY rowid') if json.loads(r['data']).get('dept')==dept]; conn.close()
    memo={'id':body.get('id') or f'memo_{int(time.time()*1000)}','title':title,'body':memo_body,'dept':dept,'status':'open','recipient_ids':[e['id'] for e in employees],'delivery_calls':[],'delivery_status':'pending'}
    upsert_entity('memo',memo)
    errors=[]
    for e in employees:
        try: memo['delivery_calls'].append(execute_call('employee',e['id'],'memo',{'title':title,'body':memo_body})['callId'])
        except Exception as ex: errors.append(f"{e['name']}: {ex}")
    memo['delivery_status']='completed' if employees and not errors else ('no_recipients' if not employees else 'partial')
    upsert_entity('memo',memo)
    add_log('memo',f"{title} published to {dept}; called {len(employees)-len(errors)} of {len(employees)} employees")
    return jsonify({'memo':memo,'called':len(employees)-len(errors),'errors':errors}),201

@app.post('/api/trigger-call')
def trigger():
    body=request.get_json() or {}
    pillar,entity_id,act=body.get('pillar'),body.get('entityId'),body.get('act')
    try:
        return jsonify(execute_call(pillar,entity_id,act))
    except PermissionError as ex: return jsonify({'error':str(ex)}),403
    except ValueError as ex: return jsonify({'error':str(ex)}),400
    except Exception as ex: return jsonify({'error':str(ex)}),500


def _call_log_row(call_id):
    conn=connect(); row=conn.execute('SELECT * FROM call_logs WHERE id=?',(call_id,)).fetchone(); conn.close()
    if not row: return None
    d=dict(row); d['structured_result']=json.loads(row['structured_result']) if row['structured_result'] else None; d['transcript']=json.loads(row['transcript']) if row['transcript'] else []
    return d

def refresh_call(call_id):
    """Reads the current status of a call, applying the result the first
    time it goes terminal. Dry-run calls are already terminal by the time
    they're logged. Live calls previously had NO way to ever be checked
    again after creation — trigger-call would fire and the log stayed at
    status=queued forever. Shared by the /api/calls/<id> route AND the
    automation engine, which polls any live call it placed until it resolves."""
    record=_call_log_row(call_id)
    if not record: return None
    if call_id.startswith('dryrun_') or record['status'] in ('completed','failed','canceled'):
        return record
    try:
        live=get_call(call_id)
    except Exception:
        return record
    if not live:
        return record
    status=live.get('status', record['status'])
    if status not in ('completed','failed','canceled'):
        record['status']=status
        return record
    structured=live.get('structured_result'); summary=live.get('summary'); transcript=live.get('transcript',[])
    save_call(call_id, record['pillar'], record['entity_id'], record['act'],
              {'summary':summary,'structured_result':structured,'transcript':transcript},
              status, record['created_at'], now(), False)
    e=entity(record['pillar'], record['entity_id'])
    if e and status=='completed':
        apply_result(record['pillar'], record['act'], e, {'structured_result':structured})
    label=(e or {}).get('name') or (e or {}).get('tool') or record['entity_id']
    add_log(record['pillar'], f"{label} — {summary or status}")
    return _call_log_row(call_id)

@app.get('/api/calls/<call_id>')
def call_status(call_id):
    record=refresh_call(call_id)
    if not record: return jsonify({'error':'call not found'}),404
    return jsonify(record)

from . import automation
automation.wire(execute_call, refresh_call)
automation.start_background_loop()

@app.get('/api/automation/status')
def automation_status():
    return jsonify(automation.get_status())

@app.post('/api/automation/run-once')
def automation_run_once():
    fired = automation.run_once()
    return jsonify({'fired': fired, 'status': automation.get_status()})


if __name__ == '__main__':
    print('Starting Relay backend...')
    app.run(
        host='0.0.0.0',
        port=int(os.getenv('FLASK_PORT', '5000')),
        debug=True,
        # Flask's debug reloader re-executes this entire module in a second
        # process to watch for file changes. Harmless normally, but this
        # module now starts a background automation thread at import time —
        # with the reloader on, that thread would start twice, in two
        # separate processes both writing to the same SQLite file, causing
        # every automated call to fire twice. use_reloader=False keeps
        # debug's error pages while avoiding that double-execution.
        use_reloader=False
    )

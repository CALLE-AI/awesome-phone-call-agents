from datetime import datetime, timezone

def first(name): return (name or '').split()[0]

def simulate(pillar, act, e, context=None):
    context = context or {}
    key=f'{pillar}:{act}'
    if key=='employee:checkin':
        turns=[('bot',f"Hi {first(e['name'])}, this is Relay calling on behalf of your company. We noticed you haven't checked in today — is everything okay?"),('user','I am working from home today and forgot to update the system.'),('bot',"No problem. I will record that and notify your manager.")]
        result={'checkin_status':'remote_today','reason':'Working from home and forgot to update the system','manager_notified':'yes','evidence':'Employee confirmed remote work today.'}; summary='Employee confirmed remote work; attendance updated.'
    elif key=='employee:meeting-reminder':
        turns=[('bot',f"Hi {first(e['name'])}, this is Relay with a reminder for {context.get('title','your upcoming meeting')} on {context.get('date','the scheduled date')} at {context.get('time','the scheduled time')}. Will you attend?"),('user','Yes, I have it on my calendar and I will attend.'),('bot','Great. I have recorded your attendance confirmation.')]
        result={'attendance':'confirmed','response':'Employee confirmed they will attend the meeting.','evidence':'Employee verbally confirmed attendance.'}; summary='Meeting reminder delivered; attendance confirmed.'
    elif key=='employee:memo':
        turns=[('bot',f"Hi {first(e['name'])}, this is Relay with a memo for the {e.get('dept','')} team: {context.get('title','company update')}. {context.get('body','Please review the latest company update.') }"),('user','Understood. I will review it today.'),('bot','Thanks. I have recorded your acknowledgement.')]
        result={'acknowledged':'yes','response':'Employee confirmed they will review the memo.','evidence':'Employee acknowledged the memo.'}; summary='Memo delivered; employee acknowledgement recorded.'
    elif key=='employee:offboard':
        tools=', '.join(e.get('assigned_software',e.get('tools',[])))
        turns=[('bot',f"Hi {first(e['name'])}, this is Relay. Since today is your last working day, I want to confirm your handoff."),('user','Sure.'),('bot',f"Can you confirm equipment return and closure of {tools} access?"),('user','Yes. I will return my laptop and badge to IT this afternoon. Please close the access.')]
        result={'handoff_status':'confirmed','equipment_return':'Laptop and badge to IT this afternoon','tool_access_confirmed':'yes','evidence':'Employee confirmed equipment return and access closeout.'}; summary='Offboarding handoff confirmed; equipment and software access recorded.'
    elif key=='customer:renewal':
        turns=[('bot',f"Hi {first(e['name'])}, this is Relay calling about your {e['plan']} plan renewal. Do you have a moment?"),('user','I want to reduce the cost.'),('bot','We can offer one lower-cost plan. Would you like to move to Standard?'),('user','Yes, switch me to Standard.')]
        result={'decision':'downgraded','plan_after_call':'Standard','reason':'Cost sensitivity','evidence':'Customer agreed to move to Standard.'}; summary='Customer downgraded due to cost sensitivity.'
    elif key=='customer:plan':
        turns=[('bot',f"Hi {first(e['name'])}, this is Relay. You asked about your current plan. What would you like to know?"),('user','What is included and can I change plans?'),('bot','Your plan includes the features listed in your account. You can change plans; I can also arrange a follow-up if you need help comparing them.')]
        result={'question':'Plan inclusions and plan changes','answer':'Current plan information explained using approved policy.','follow_up':'none','evidence':'Customer received plan information.'}; summary='Plan information delivered; no follow-up required.'
    elif key=='customer:issue':
        turns=[('bot',f"Hi {first(e['name'])}, this is Relay following up on your recent issue. Can you tell me what is still blocking you?"),('user','The issue is resolved now, but I wanted the team to know it was frustrating.'),('bot','I will record that feedback and the issue as resolved.')]
        result={'issue':e.get('recent_issue','Recent support issue'),'severity':'low','resolution':'Customer reports issue is resolved.','escalated':'no','evidence':'Customer confirmed resolution.'}; summary='Customer issue follow-up completed; issue resolved.'
    elif key=='customer:feedback':
        turns=[('bot',f"Hi {first(e['name'])}, this is Relay with a quick feedback call. How has your experience been?"),('user','Mostly positive. Faster support would make it better.'),('bot','Thank you. I will record that feedback for the team.')]
        result={'sentiment':'positive','feedback':'Customer wants faster support response times.','follow_up':'Share feedback with customer success','evidence':'Customer provided actionable feedback.'}; summary='Positive feedback captured with faster support as an improvement area.'
    elif key in ('license:usage-review','license:seat-reclaim'):
        seats=e['seats_purchased']; active=e['seats_active']; new_seats=max(active, seats-1) if key.endswith('seat-reclaim') else active
        action='reclaim one unused seat' if key.endswith('seat-reclaim') else f'reduce purchased seats to {new_seats}'
        turns=[('bot',f"Hi {first(e.get('owner','there'))}, this is Relay calling about {e['tool']}. You have {active} active seats out of {seats} purchased, costing ${seats*e['cost_per_seat']} per month."),('user',f"Please {action}; we do not need the unused capacity."),('bot','Understood. I will record the decision for operations and finance.')]
        decision='downgrade' if not key.endswith('seat-reclaim') else 'downgrade'
        result={'decision':decision,'seats_after_call':str(new_seats),'monthly_cost_after_call':str(new_seats*e['cost_per_seat']),'reason':'Low utilization; owner approved reducing unused capacity.','evidence':'Department owner confirmed seat reduction.'}
        summary=f"{e['tool']} seats reduced from {seats} to {new_seats}; monthly spend recalculated."
    else:
        turns=[('bot','Relay completed a simulated operational call.'),('user','Confirmed.')]; result={'evidence':'Simulated result'}; summary='Simulated call completed.'
    transcript=[]; offset=0
    for speaker,text in turns:
        transcript.append({'offset_seconds':offset,'speaker':speaker,'text':text}); offset += 4 + round(len(text)/12)
    ts=datetime.now(timezone.utc).isoformat()
    return {'status':'completed','summary':summary,'structured_result':result,'transcript':transcript,'created_at':ts,'completed_at':ts}

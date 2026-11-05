"""Read-only business projection of persisted results; no inference or writes."""
from urllib.parse import urlsplit


FIELD_LABELS={
    'budget_max':'Budget ceiling','preferred_area':'Preferred area','bedrooms':'Bedrooms',
    'living_room_priority':'Living-room preference','subway_preference':'Transport preference',
    'purchase_timeline':'Purchase timeline','next_viewing_interest':'Continued viewing interest',
    'contact_allowed':'Contact permission',
}


def has_value(value):
    """Unknown sentinels are not business values; False and zero still are."""
    if value is None:return False
    if isinstance(value,str):
        return value.strip().casefold() not in {'','unknown','unclear','null','none','n/a','not mentioned','not provided','pending review','uncertain','none available'}
    if isinstance(value,(list,dict)):
        return any(has_value(v) for v in (value.values() if isinstance(value,dict) else value))
    return True


def display_value(value,field=''):
    if not has_value(value):return 'Not recorded'
    if field=='budget_max' and type(value) in (int,float):return f'CNY {value:,.0f}'
    if field=='contact_allowed' and type(value) is bool:return 'Follow-up allowed' if value else 'Do not contact'
    if isinstance(value,list):return '; '.join(display_value(v) for v in value if has_value(v))
    return str(value)


def crm_suggestions(run):
    """Filter display only. Pending suggestions keep their review status."""
    batch=run.get('batch') or {}
    props={p['id']:p['label'] for p in run['context']['properties']}
    rows=[]
    for key,status in [('accepted','Suggested update'),('pending','Pending review')]:
        for entry in batch.get(key,[]):
            if not has_value(entry.get('value')):continue
            target=props.get(entry.get('property_id'),'Attribution pending')+' · Viewing feedback' if entry.get('kind')=='feedback' else 'Customer profile'
            rows.append({**entry,'label':target+' · '+FIELD_LABELS.get(entry['field'],entry['field']),
                'display_old':display_value(entry.get('old_value'),entry['field']),
                'display_new':display_value(entry['value'],entry['field']),'display_status':status})
    return rows


def task_overview(run):
    """Organize existing findings by the follow-up goal; never invent answers."""
    result=(run.get('call') or {}).get('result') or {}
    analysis=run.get('analysis') or {}
    props={p['id']:p['label'] for p in run['context']['properties']}
    feedback=[]
    for i,v in enumerate(run['context']['viewings'],1):
        text=result.get(f'p{i}_feedback')
        if not has_value(text):
            parts=[prefix+str(result[f'p{i}_{key}']) for key,prefix in [('positive','Positives: '),('negative','Concerns: ')]
                   if has_value(result.get(f'p{i}_{key}'))]
            if not parts:
                parts=[x['text'] for x in analysis.get('feedback',[]) if x['property_id']==v['property_id'] and has_value(x.get('text'))]
            text='; '.join(parts)
        if has_value(text):feedback.append(props[v['property_id']]+': '+str(text))
    needs=[str(result[k]) for k in ['budget_statement','priority_statement'] if has_value(result.get(k))]
    follow=[str(result[k]) for k in ['next_step_statement','contact_preference'] if has_value(result.get(k))]
    if not needs:
        needs=[FIELD_LABELS.get(c['field'],c['field'])+': '+display_value(c['value'],c['field'])
               for c in analysis.get('changes',[]) if c['field'] not in {'next_viewing_interest','contact_allowed'} and has_value(c.get('value'))]
    if not follow:
        follow=[display_value(c['value'],c['field']) for c in analysis.get('changes',[])
                if c['field'] in {'next_viewing_interest','contact_allowed'} and has_value(c.get('value'))]
    return [(title,list(dict.fromkeys(lines))) for title,lines in [('Viewing feedback',feedback),('Requirement changes and trade-offs',needs),('Follow-up preferences',follow)] if lines]


def recording_url(call):
    """An optional provider extension, not a promised public CALL-E field.

    The current real Call snapshot contains no recording address. Never turn
    TTS output, a local file or an inferred URL into an original recording.
    """
    value=call.get('recording_url')
    if not isinstance(value,str):return None
    try:parsed=urlsplit(value)
    except ValueError:return None
    return value if parsed.scheme=='https' and parsed.hostname and not parsed.username and not parsed.password else None

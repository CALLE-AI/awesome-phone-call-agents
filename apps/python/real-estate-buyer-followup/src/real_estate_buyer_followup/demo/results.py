"""Read-only business projection of persisted results; no inference or writes."""
from urllib.parse import urlsplit


FIELD_LABELS={
    'budget_max':'预算上限','preferred_area':'意向区域','bedrooms':'户型房间数',
    'living_room_priority':'客厅空间偏好','subway_preference':'交通偏好',
    'purchase_timeline':'购房时间','next_viewing_interest':'继续看房意愿',
    'contact_allowed':'后续联系权限',
}


def has_value(value):
    """Unknown sentinels are not business values; False and zero still are."""
    if value is None:return False
    if isinstance(value,str):
        return value.strip().casefold() not in {'','unknown','unclear','null','none','n/a','未提及','未提供','未知','待确认','不确定','暂无'}
    if isinstance(value,(list,dict)):
        return any(has_value(v) for v in (value.values() if isinstance(value,dict) else value))
    return True


def display_value(value,field=''):
    if not has_value(value):return '未记录'
    if field=='budget_max' and type(value) in (int,float):return f'{value/10000:g}万元'
    if field=='contact_allowed' and type(value) is bool:return '允许后续联系' if value else '不再联系'
    if isinstance(value,list):return '；'.join(display_value(v) for v in value if has_value(v))
    return str(value)


def crm_suggestions(run):
    """Filter display only. Pending suggestions keep their review status."""
    batch=run.get('batch') or {}
    props={p['id']:p['label'] for p in run['context']['properties']}
    rows=[]
    for key,status in [('accepted','建议更新'),('pending','待确认')]:
        for entry in batch.get(key,[]):
            if not has_value(entry.get('value')):continue
            target=props.get(entry.get('property_id'),'归属待确认')+' · 带看反馈' if entry.get('kind')=='feedback' else '客户档案'
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
            parts=[prefix+str(result[f'p{i}_{key}']) for key,prefix in [('positive','满意点：'),('negative','顾虑：')]
                   if has_value(result.get(f'p{i}_{key}'))]
            if not parts:
                parts=[x['text'] for x in analysis.get('feedback',[]) if x['property_id']==v['property_id'] and has_value(x.get('text'))]
            text='；'.join(parts)
        if has_value(text):feedback.append(props[v['property_id']]+'：'+str(text))
    needs=[str(result[k]) for k in ['budget_statement','priority_statement'] if has_value(result.get(k))]
    follow=[str(result[k]) for k in ['next_step_statement','contact_preference'] if has_value(result.get(k))]
    if not needs:
        needs=[FIELD_LABELS.get(c['field'],c['field'])+'：'+display_value(c['value'],c['field'])
               for c in analysis.get('changes',[]) if c['field'] not in {'next_viewing_interest','contact_allowed'} and has_value(c.get('value'))]
    if not follow:
        follow=[display_value(c['value'],c['field']) for c in analysis.get('changes',[])
                if c['field'] in {'next_viewing_interest','contact_allowed'} and has_value(c.get('value'))]
    return [(title,list(dict.fromkeys(lines))) for title,lines in [('看房反馈',feedback),('需求变化与取舍',needs),('后续意愿',follow)] if lines]


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

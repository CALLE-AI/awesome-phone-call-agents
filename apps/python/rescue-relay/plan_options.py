"""Complete rescue plans assembled from verified capability offers.

A plan maps every required capability to exactly one responder. A responder may
cover several capabilities, with its quoted bundle counted once. The generator
suggests one representative assignment per nonredundant responder combination;
manual task assignments are retained as a custom complete plan. Enumeration is
bounded and explicitly reports truncation, rather than claiming exhaustiveness.
"""
from __future__ import annotations
import hashlib
import json
from pricing import cost_summary


def plan_id(selection: dict[str,str]) -> str:
    return 'plan_'+hashlib.sha256(json.dumps(selection,sort_keys=True,separators=(',',':')).encode()).hexdigest()[:20]


def make_option(coverage: dict, selection: dict[str,str]) -> dict | None:
    needs=coverage['requirements']
    if not needs or set(selection)!={n['id'] for n in needs}:
        return None
    assigned=[];helpers={}
    for need in needs:
        offer=next((o for o in need['offers'] if o['status']=='committed' and o['contact_id']==selection[need['id']]),None)
        if not offer:return None
        assigned.append({**need,'assignment':offer})
        h=helpers.setdefault(offer['contact_id'],{'contact_id':offer['contact_id'],'name':offer['contact_name'],'tasks':[], 'quote':offer.get('quote'), 'eta_minutes':offer.get('eta_minutes')})
        h['tasks'].append({'id':need['id'],'label':need['label']})
    cost=coverage['cost']
    return {'id':plan_id(selection),'assignments':selection.copy(),'goal':coverage['goal'],
            'helpers':list(helpers.values()),'helpers_count':len(helpers),'capabilities_count':len(needs),
            'cost':cost_summary(assigned,budget=cost['budget'],currency=cost['currency']),
            'complete':True,'selected':selection==coverage['selection']}


def build_plan_options(coverage: dict, *, max_options: int=32, max_states: int=20000) -> dict:
    needs=coverage['requirements']
    none={'options':[],'selected_plan_id':None,'options_limited':False,
          'options_note':'Partial offers are building blocks, not complete plans.'}
    if not needs:return none
    ids=[n['id'] for n in needs]
    choices={n['id']:list(dict.fromkeys(o['contact_id'] for o in n['offers'] if o['status']=='committed')) for n in needs}
    if any(not v for v in choices.values()):return none
    order={o['contact_id']:i for i,o in enumerate(coverage['contact_offers'])}
    by_contact={c:{n for n,offers in choices.items() if c in offers} for c in order}
    full=set(ids);visited=set();solutions=set();limited=False
    def visit(selected: frozenset[str],covered: set[str]):
        nonlocal limited
        if selected in visited:return
        if len(visited)>=max_states or len(solutions)>=max_options:
            limited=True;return
        visited.add(selected)
        if covered==full:
            # No extra callbacks to a helper whose removal leaves a full plan.
            if all(set().union(*(by_contact[c] for c in selected if c!=drop))!=full for drop in selected):
                solutions.add(selected)
            return
        missing=min((n for n in ids if n not in covered),key=lambda n:len(choices[n]))
        for c in choices[missing]:visit(selected|{c},covered|by_contact[c])
    visit(frozenset(),set())
    # New inquiries append plans without renumbering previously generated plans.
    groups=sorted(solutions,key=lambda group:(max(order[c] for c in group),len(group),tuple(sorted(order[c] for c in group))))
    options=[]
    for number,group in enumerate(groups,1):
        assignments={n:next(c for c in choices[n] if c in group) for n in ids}
        item=make_option(coverage,assignments)
        if item:options.append({**item,'label':f'Plan {number}','custom':False})
    selected=make_option(coverage,coverage['selection'])
    if selected and not any(o['id']==selected['id'] for o in options):
        options.append({**selected,'label':'Custom plan','custom':True})
    return {'options':options,'selected_plan_id':selected['id'] if selected else None,'options_limited':limited,
            'options_note':('Showing a bounded set of complete plans; other task combinations may exist. Customise the selected plan to explore them.' if limited else 'Each plan covers every required capability. One representative assignment is shown per nonredundant responder combination.')}

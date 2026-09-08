"""Reconcile a CALL-E result into an operator-approved planning snapshot.
This does not reserve recipient capacity or perform a donation. Fixture demo only
uses invented records. Real results must be inspected by an authorized operator.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import time
from pathlib import Path
from calls import (interpret,normalize_provider_result,provider_id,RESULT_FORMAT,strict_json,
                   save_private_json,Ledger,context_test_mode,ROLE_PLAY_SCOPE)
from optimizer import solve,validate,Invalid,integer,simulation_mode

ROOT=Path(__file__).resolve().parent

def snapshot_hash(data:dict)->str:
    return hashlib.sha256(json.dumps(data,sort_keys=True,allow_nan=False).encode()).hexdigest()

def reconcile(data:dict,partner_id:str,result:dict,offered:int,now:int,
              approval_sha:str,source_reference:str,*,confirmed_at:int,
              evidence_approval_sha:str,acknowledge_review:bool,category=None,test_mode=False)->dict:
    if type(test_mode) is not bool:raise Invalid('test_mode must be a boolean')
    if simulation_mode(data)!=test_mode:
        raise Invalid('Role-play allocation requires both test_mode=true evidence and simulation=true snapshot; no real capacity is established')
    metadata=result.get('metadata',{}) if isinstance(result,dict) else {}
    if isinstance(metadata,dict) and metadata.get('test_mode') is True and not test_mode:
        raise Invalid('Role-play provider evidence cannot confirm real organization capacity')
    if approval_sha!=snapshot_hash(data):raise Invalid('Human approval is for a different planning snapshot')
    expected=evidence_hash(result,partner_id,offered,confirmed_at,source_reference,category,test_mode)
    if evidence_approval_sha!=expected or acknowledge_review is not True:
        raise Invalid('Exact evidence approval and explicit human verification are required')
    validate(data)
    integer(now,'now',0,10**12)
    integer(confirmed_at,'confirmed_at',0,10**12)
    if not 0<=now-confirmed_at<=data.get('confirmation_ttl',3600):
        raise Invalid('Actual confirmation is stale or future-dated; importing it cannot renew it')
    if not isinstance(source_reference,str) or not source_reference.strip():raise Invalid('Call/result reference required')
    candidate=interpret(result,offered)
    if candidate['disposition']!='candidate_confirmation':raise Invalid(candidate['reason'])
    out=copy.deepcopy(data)
    partners=[p for p in out['partners'] if p['id']==partner_id]
    if len(partners)!=1:raise Invalid('Unknown or duplicate partner')
    out['now']=now
    partners[0].update({'capacity':candidate['capacity'],'manager_verified':True,
      'confirmed_at':confirmed_at,'confirmation_reference':source_reference,
      'operator_approved_quote':candidate['quote']})
    if category is not None:
        if not isinstance(category,str) or category not in partners[0]['accepts']:
            raise Invalid('Called category is not accepted in the approved snapshot')
        # A single-category inquiry must not silently enable unrelated food categories.
        partners[0]['accepts']=[category]
    if test_mode:
        provenance={'test_mode':True,'evidence_scope':ROLE_PLAY_SCOPE,'source_reference':source_reference,
                    'real_organization_capacity_confirmed':False,'real_donation':False}
        out['simulation_provenance']=copy.deepcopy(provenance)
        partners[0]['capacity_scope']=ROLE_PLAY_SCOPE
        partners[0]['confirmation_reference']='ROLE_PLAY:'+source_reference
    # Validate complete updated snapshot; do not persist partial/invalid updates.
    plan=solve(out)
    output={'snapshot':out,'plan':plan,'approval':{'snapshot_sha':approval_sha,
            'evidence_sha':expected,'source_reference':source_reference,'confirmed_at':confirmed_at},
            'warning':'Proposal only. Human approval is an operator assertion, not independent verification.'}
    if test_mode:
        plan.update({'simulation':True,'evidence_scope':ROLE_PLAY_SCOPE,'real_donation':False})
        output.update({'mode':'provider_role_play_simulation','provenance':provenance,
                       'warning':'Fictional allocation demonstration only. The participant confirmed a role-play quantity, not real organization capacity. No real food or donation is involved.'})
        output['approval']['test_mode']=True
    return output


def evidence_hash(result,partner_id,offered,confirmed_at,source_reference,category=None,test_mode=False):
    evidence={'result':result,'partner_id':partner_id,'offered':offered,
              'confirmed_at':confirmed_at,'source_reference':source_reference,'category':category}
    if test_mode:evidence['test_mode']=True
    return snapshot_hash(evidence)


def review_result(data,envelope,confirmed_at,*,ledger,clock=time.time):
    """Prepare a read-only review of the exact retrieved evidence and planning input.
    The local envelope is provenance bookkeeping, not a signed provider attestation.
    """
    now=integer(int(clock()),'current_time',0,10**12)
    validate(data)
    simulation=simulation_mode(data)
    if not isinstance(envelope,dict) or envelope.get('format')!=RESULT_FORMAT or envelope.get('source')!='call-e-rest-get':
        raise Invalid('Use a result envelope from calls.py read mode; raw fixtures cannot enter the live import path')
    ledger.verify_envelope(envelope)
    cid=provider_id(envelope.get('provider_id'))
    digest=envelope.get('request_sha')
    if not isinstance(digest,str) or len(digest)!=64 or any(c not in '0123456789abcdef' for c in digest):
        raise Invalid('Missing request approval reference')
    info=envelope.get('request')
    if not isinstance(info,dict):raise Invalid('Missing original request context')
    test_mode=context_test_mode(info)
    scope=ROLE_PLAY_SCOPE if test_mode else 'organization_capacity_inquiry'
    if info.get('evidence_scope',scope)!=scope:raise Invalid('Conflicting request evidence scope')
    offered=integer(info.get('offered_portions'),'offered_portions',1,10000)
    requested=integer(info.get('requested_at'),'requested_at',0,10**12)
    fetched=integer(envelope.get('fetched_at'),'fetched_at',0,10**12)
    integer(confirmed_at,'confirmed_at',0,10**12);integer(now,'now',0,10**12)
    if not requested<=confirmed_at<=fetched<=now:
        raise Invalid('Verify the actual confirmation time against creation and result retrieval')
    if now-confirmed_at>data.get('confirmation_ttl',3600):raise Invalid('Actual capacity confirmation is stale')
    partners=[p for p in data['partners'] if p['id']==info.get('partner_id')]
    batches=[b for b in data['batches'] if b['id']==info.get('batch_id')]
    if len(partners)!=1 or len(batches)!=1 or batches[0]['category']!=info.get('category'):
        raise Invalid('Original request does not match this partner, batch and category')
    if info['category'] not in partners[0]['accepts']:raise Invalid('Called category is not accepted')
    result=normalize_provider_result(envelope.get('result'),cid)
    candidate=interpret(result,offered)
    if test_mode:
        candidate['evidence_scope']=ROLE_PLAY_SCOPE
        if candidate['disposition']=='candidate_confirmation':
            candidate['disposition']='candidate_role_play_confirmation'
            candidate['fictional_capacity']=candidate.pop('capacity')
        candidate['warning']='Role-play evidence only; does not establish real organization capacity.'
    output={'mode':'private_role_play_review_no_allocation' if test_mode else 'private_review_no_allocation',
            'candidate':candidate,'test_mode':test_mode,'evidence_scope':scope,
            'simulation_snapshot':simulation,'partner_id':info['partner_id'],
            'batch_id':info['batch_id'],'category':info['category'],'offered':offered,
            'confirmed_at':confirmed_at,'planning_at':now,'provider_id':cid,
            'input_sha':snapshot_hash(data),'evidence_sha':evidence_hash(result,info['partner_id'],offered,confirmed_at,cid,info['category'],test_mode),
            'review_sha':snapshot_hash({'snapshot':data,'envelope':envelope,'confirmed_at':confirmed_at}),
            'result':result,'required_review':'Verify recipient identity, actual affirmative capacity, exact quote and confirmation time in the provider dashboard. Then explicitly acknowledge. Only the called category will remain enabled.'}
    if test_mode:
        output['required_review']='Verify the consenting test participant, recorded AI role-play disclosure, exact fictional quantity and quote, and actual confirmation time in the provider evidence. Allocation requires a simulation=true fictional snapshot and exact human approval. No real organization capacity or donation may be claimed.'
    return output


def apply_review(data,envelope,confirmed_at,approved_review_sha,acknowledge_review,*,ledger,clock=time.time):
    now=integer(int(clock()),'current_time',0,10**12)
    review=review_result(data,envelope,confirmed_at,ledger=ledger,clock=lambda:now)
    if review['review_sha']!=approved_review_sha:raise Invalid('Approval does not match this exact evidence and snapshot review')
    output=reconcile(data,review['partner_id'],review['result'],review['offered'],now,
        review['input_sha'],review['provider_id'],confirmed_at=confirmed_at,
        evidence_approval_sha=review['evidence_sha'],acknowledge_review=acknowledge_review,
        category=review['category'],test_mode=review['test_mode'])
    output['approval'].update({'review_sha':approved_review_sha,'request_sha':envelope['request_sha'],
                               'fetched_at':envelope['fetched_at'],'planning_at':now})
    if review['test_mode']:
        output['provenance'].update({'source':envelope['source'],'request_sha':envelope['request_sha'],
            'provider_id':envelope['provider_id'],'fetched_at':envelope['fetched_at']})
    return output

def demo(approve_fixture:bool)->dict:
    data=json.loads((ROOT/'sample.json').read_text());data['partners'][0]['manager_verified']=False
    initial=solve(data);provider=json.loads((ROOT/'call_result_fixture.json').read_text())
    result={'mode':'fully_synthetic_no_call','before':initial,'candidate':interpret(provider,12),
      'snapshot_approval_sha':snapshot_hash(data),'after':None}
    if approve_fixture:
        result['after']=reconcile(data,'near',provider,12,data['now'],snapshot_hash(data),'FICTIONAL_CALL_FIXTURE',
            confirmed_at=data['now'],evidence_approval_sha=evidence_hash(provider,'near',12,data['now'],'FICTIONAL_CALL_FIXTURE'),
            acknowledge_review=True)['plan']
    return result

if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    sub=ap.add_subparsers(dest='command',required=True)
    d=sub.add_parser('demo');d.add_argument('--approve-fixture',action='store_true');d.add_argument('--output')
    for name in ('review','reconcile'):
        r=sub.add_parser(name);r.add_argument('snapshot');r.add_argument('result')
        r.add_argument('--db',default='calls.sqlite3')
        r.add_argument('--confirmed-at',type=int,required=True)
        r.add_argument('--output',required=True)
        if name=='reconcile':
            r.add_argument('--approve-review-sha',required=True)
            r.add_argument('--acknowledge-evidence-review',action='store_true')
    args=ap.parse_args()
    try:
        if args.command=='demo':output=demo(args.approve_fixture)
        else:
            data=strict_json(Path(args.snapshot).read_text());envelope=strict_json(Path(args.result).read_text())
            if args.command=='review':output=review_result(data,envelope,args.confirmed_at,ledger=Ledger(args.db))
            else:output=apply_review(data,envelope,args.confirmed_at,args.approve_review_sha,args.acknowledge_evidence_review,ledger=Ledger(args.db))
        text=json.dumps(output,indent=2)
        if args.output:save_private_json(args.output,output)
        else:print(text)
    except (OSError,ValueError,KeyError,TypeError) as exc:ap.error(str(exc))

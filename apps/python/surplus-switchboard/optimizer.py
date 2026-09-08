"""Exact max-portions / min-portion-minutes flow for a bounded planning model.
No food-safety assessment, route optimization, transport or donation is performed.
"""
from __future__ import annotations
from dataclasses import dataclass
import copy
import hashlib
import json
from typing import Any

class Invalid(ValueError):
    pass

ROLE_PLAY_SCOPE='fictional_role_play'


def simulation_mode(data):
    if not isinstance(data,dict):raise Invalid('Input must be an object')
    simulation=data.get('simulation',False)
    if type(simulation) is not bool:raise Invalid('simulation must be a boolean')
    partners=data.get('partners',[])
    role_play=bool(data.get('simulation_provenance')) or (isinstance(partners,list) and any(
        isinstance(p,dict) and p.get('capacity_scope')==ROLE_PLAY_SCOPE for p in partners))
    if role_play and not simulation:
        raise Invalid('Role-play provenance cannot be relabeled as a real planning snapshot')
    if 'simulation_provenance' in data:
        provenance=data['simulation_provenance']
        if (not isinstance(provenance,dict) or provenance.get('test_mode') is not True
            or provenance.get('evidence_scope')!=ROLE_PLAY_SCOPE
            or provenance.get('real_organization_capacity_confirmed') is not False
            or provenance.get('real_donation') is not False):
            raise Invalid('Invalid or conflicting fictional role-play provenance')
    return simulation


def integer(x: Any, name: str, lo: int = 0, hi: int = 1_000_000) -> int:
    if type(x) is not int or not lo <= x <= hi:
        raise Invalid(f'{name} must be an integer in [{lo}, {hi}]')
    return x

def validate(data: dict) -> tuple[list, list, list, list]:
    if not isinstance(data, dict):
        raise Invalid('Input must be an object')
    simulation_mode(data)
    now = integer(data.get('now'), 'now', 0, 10**12)
    ttl = integer(data.get('confirmation_ttl', 3600), 'confirmation_ttl', 1, 86400)
    batches, partners, lanes = data.get('batches'), data.get('partners'), data.get('lanes')
    if not all(isinstance(x, list) for x in (batches, partners, lanes)):
        raise Invalid('batches, partners and lanes must be lists')
    if len(batches) > 50 or len(partners) > 50 or len(lanes) > 2500:
        raise Invalid('Bounded planner: at most 50 batches, 50 partners and 2500 lanes')
    seen = set()
    for b in batches:
        if not isinstance(b, dict) or not isinstance(b.get('id'), str) or not b['id'] or b['id'] in seen:
            raise Invalid('Batch IDs must be unique, nonempty strings')
        seen.add(b['id'])
        integer(b.get('portions'), 'portions')
        integer(b.get('ready_at'), 'ready_at', 0, 10**12)
        integer(b.get('expires_at'), 'expires_at', 0, 10**12)
        if b['expires_at'] < b['ready_at'] or not isinstance(b.get('category'), str):
            raise Invalid('Invalid batch time or category')
        if type(b.get('operator_cleared')) is not bool:
            raise Invalid('operator_cleared must be boolean')
    seen = set()
    for p in partners:
        if not isinstance(p, dict) or not isinstance(p.get('id'), str) or not p['id'] or p['id'] in seen:
            raise Invalid('Partner IDs must be unique, nonempty strings')
        seen.add(p['id'])
        integer(p.get('capacity'), 'capacity')
        integer(p.get('confirmed_at'), 'confirmed_at', 0, 10**12)
        integer(p.get('receive_by'), 'receive_by', 0, 10**12)
        if type(p.get('manager_verified')) is not bool or not isinstance(p.get('accepts'), list) or any(not isinstance(c,str) for c in p['accepts']):
            raise Invalid('Partner confirmation and accepted categories are required')
    bs = {b['id']: b for b in batches}
    ps = {p['id']: p for p in partners}
    allowed, rejected, seen = [], [], set()
    for lane in lanes:
        if not isinstance(lane, dict):
            raise Invalid('Each lane must be an object')
        key = (lane.get('batch'), lane.get('partner'))
        if not all(isinstance(v,str) for v in key) or key[0] not in bs or key[1] not in ps or key in seen:
            raise Invalid('Lane references must be known and unique')
        seen.add(key)
        minutes = integer(lane.get('minutes'), 'minutes', 0, 1440)
        b, p = bs[key[0]], ps[key[1]]
        arrival = max(now, b['ready_at']) + 60 * minutes
        reason = None
        if not b['operator_cleared']:
            reason = 'Batch not cleared by operator'
        elif not p['manager_verified']:
            reason = 'Capacity not verified by manager'
        elif not 0 <= now - p['confirmed_at'] <= ttl:
            reason = 'Capacity confirmation stale or future-dated'
        elif b['category'] not in p['accepts']:
            reason = 'Category not accepted'
        elif arrival >= b['expires_at']:
            reason = 'Arrival is not before expiry'
        elif arrival > p['receive_by']:
            reason = 'Arrival after receiving cutoff'
        elif not b['portions'] or not p['capacity']:
            reason = 'No supply or capacity'
        item = {**lane, 'arrival_at': arrival}
        if reason:
            rejected.append({**item, 'reason': reason})
        else:
            allowed.append(item)
    return batches, partners, allowed, rejected

@dataclass
class Edge:
    to: int
    rev: int
    cap: int
    cost: int
    original: int

def solve(data: dict) -> dict:
    """Successive shortest augmenting paths, including reverse rerouting edges.
    Bellman-Ford supports negative reverse costs; integer flows are exact.
    Objective: maximum portions, then minimum sum(portions * lane minutes).
    """
    batches, partners, lanes, rejected = validate(data)
    n = len(batches) + len(partners) + 2
    source, sink = n - 2, n - 1
    graph: list[list[Edge]] = [[] for _ in range(n)]
    bidx = {b['id']: i for i,b in enumerate(batches)}
    pidx = {p['id']: i + len(batches) for i,p in enumerate(partners)}
    def add(u, v, cap, cost):
        forward = Edge(v, len(graph[v]), cap, cost, cap)
        graph[u].append(forward)
        graph[v].append(Edge(u, len(graph[u])-1, 0, -cost, 0))
        return forward
    for b in batches: add(source, bidx[b['id']], b['portions'], 0)
    for p in partners: add(pidx[p['id']], sink, p['capacity'], 0)
    refs = []
    for lane in lanes:
        b = batches[bidx[lane['batch']]]
        p = partners[pidx[lane['partner']] - len(batches)]
        refs.append((lane, add(bidx[b['id']], pidx[p['id']], min(b['portions'], p['capacity']), lane['minutes'])))
    total, cost = 0, 0
    while True:
        dist, prev = [float('inf')]*n, [None]*n
        dist[source] = 0
        for _ in range(n-1):
            changed = False
            for u in range(n):
                if dist[u] == float('inf'): continue
                for k,e in enumerate(graph[u]):
                    if e.cap > 0 and dist[u] + e.cost < dist[e.to]:
                        dist[e.to] = dist[u]+e.cost
                        prev[e.to] = (u,k)
                        changed = True
            if not changed: break
        if prev[sink] is None: break
        v, amount = sink, 10**15
        while v != source:
            u,k = prev[v]; amount = min(amount, graph[u][k].cap); v=u
        v = sink
        while v != source:
            u,k = prev[v]; e=graph[u][k]
            e.cap -= amount; graph[v][e.rev].cap += amount; v=u
        total += amount; cost += amount*int(dist[sink])
    reach, queue = {source}, [source]
    for u in queue:
        for e in graph[u]:
            if e.cap and e.to not in reach: reach.add(e.to); queue.append(e.to)
    cut = sum(e.original for u in reach for e in graph[u] if e.to not in reach)
    allocations = [{**lane,'portions':e.original-e.cap} for lane,e in refs if e.original>e.cap]
    canonical=json.dumps(data,sort_keys=True,separators=(',',':')).encode()
    output={'status':'proposal_requires_human_approval','portions':total,
            'portion_minutes':cost,'allocations':allocations,'rejected_lanes':rejected,
            'input_sha256':hashlib.sha256(canonical).hexdigest(),
            'max_flow_certificate':{'flow':total,'cut_capacity':cut,'sink_reachable':sink in reach},
            'assumptions':['All lanes independently available; not a vehicle-routing solution.',
                           'Portions are homogeneous integer units within each batch.',
                           'Capacity freshness and safety clearance are supplied by people.',
                           'No actual food, transport, cost, or environmental savings measured.']}
    if data.get('simulation') is True:
        role_play=bool(data.get('simulation_provenance')) or any(p.get('capacity_scope')==ROLE_PLAY_SCOPE for p in partners)
        output.update({'simulation':True,'evidence_scope':ROLE_PLAY_SCOPE if role_play else 'fictional_simulation',
            'real_donation':False,'real_organization_capacity_confirmed':False,
            'warning':'Fictional allocation demonstration only. No real organization capacity or donation is established.'})
        if 'simulation_provenance' in data:
            output['simulation_provenance']=copy.deepcopy(data['simulation_provenance'])
    return output

def greedy(data: dict) -> tuple[int,int]:
    """Transparent nearest-lane baseline; may consume flexible capacity too early."""
    batches, partners, lanes, _ = validate(data)
    b={x['id']:x['portions'] for x in batches}; p={x['id']:x['capacity'] for x in partners}
    qty=cost=0
    for lane in sorted(lanes,key=lambda x:(x['minutes'],x['batch'],x['partner'])):
        amount=min(b[lane['batch']],p[lane['partner']])
        b[lane['batch']]-=amount;p[lane['partner']]-=amount
        qty+=amount;cost+=amount*lane['minutes']
    return qty,cost

if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('input');ap.add_argument('--output')
    args=ap.parse_args()
    try:
        from pathlib import Path
        result=solve(json.loads(Path(args.input).read_text()))
        encoded=json.dumps(result,indent=2)
        if args.output: Path(args.output).write_text(encoded+'\n')
        else: print(encoded)
    except (Invalid,OSError,json.JSONDecodeError) as exc:
        ap.error(str(exc))

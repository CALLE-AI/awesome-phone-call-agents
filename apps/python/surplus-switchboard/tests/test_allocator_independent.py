"""Exhaustive small-instance oracle; eligibility is independent of optimizer.validate."""
import itertools
import random
import unittest
from optimizer import solve
from test_workflow import case


def independently_allowed(data,lane):
    batch=next(b for b in data['batches'] if b['id']==lane['batch'])
    partner=next(p for p in data['partners'] if p['id']==lane['partner'])
    departure=data['now'] if data['now']>batch['ready_at'] else batch['ready_at']
    arrival=departure+lane['minutes']*60
    return (batch['operator_cleared'] is True and partner['manager_verified'] is True
            and partner['confirmed_at']<=data['now']
            and partner['confirmed_at']>=data['now']-data['confirmation_ttl']
            and batch['category'] in partner['accepts']
            and arrival<batch['expires_at'] and arrival<=partner['receive_by'])


class IndependentOracleTests(unittest.TestCase):
    def test_300_random_instances_with_independent_eligibility_and_enumeration(self):
        rng=random.Random(20260908)
        for index in range(300):
            data=case()
            for batch in data['batches']:
                batch['portions']=rng.randrange(4)
                batch['operator_cleared']=rng.random()<.85
                batch['ready_at']=rng.choice([9900,10000,10100])
                batch['expires_at']=rng.choice([10200,10300,11000])
            for partner in data['partners']:
                partner['capacity']=rng.randrange(4)
                partner['manager_verified']=rng.random()<.85
                partner['confirmed_at']=rng.choice([6399,6400,9999,10000,10001])
                partner['receive_by']=rng.choice([10000,10060,10120,11000])
                partner['accepts']=[category for category in ['produce','bread'] if rng.random()<.75]
            data['lanes']=[{'batch':b['id'],'partner':p['id'],'minutes':rng.randrange(4)}
                            for b in data['batches'] for p in data['partners'] if rng.random()<.9]
            lanes=[lane for lane in data['lanes'] if independently_allowed(data,lane)]
            best=(0,0)
            for portions in itertools.product(range(4),repeat=len(lanes)):
                if any(sum(x for x,l in zip(portions,lanes) if l['batch']==b['id'])>b['portions'] for b in data['batches']):continue
                if any(sum(x for x,l in zip(portions,lanes) if l['partner']==p['id'])>p['capacity'] for p in data['partners']):continue
                best=min(best,(-sum(portions),sum(x*l['minutes'] for x,l in zip(portions,lanes))))
            actual=solve(data)
            self.assertEqual((-actual['portions'],actual['portion_minutes']),best,f'instance {index}')
            self.assertEqual(actual['max_flow_certificate']['cut_capacity'],actual['portions'])
            for allocation in actual['allocations']:self.assertTrue(independently_allowed(data,allocation))


if __name__=='__main__':unittest.main()

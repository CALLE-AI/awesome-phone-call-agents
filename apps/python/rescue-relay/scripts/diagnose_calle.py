#!/usr/bin/env python3
"""Inspect saved CALL-E operations. Read-only SQLite; optional GET-only provider reads.

No POST, no replay, no call creation, no database changes. Default output excludes
raw request/response bodies. --include-private requires an output file and writes
private case/recipient data; review before sharing with anyone.
"""
from __future__ import annotations
import argparse
from contextlib import closing
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import httpx
from dotenv import load_dotenv

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))


def read_operations(database: Path, run_id: str | None = None) -> list[dict]:
    # mode=ro prevents a typo from creating an empty replacement database.
    with closing(sqlite3.connect(database.resolve().as_uri()+'?mode=ro',uri=True)) as db:
        db.row_factory=sqlite3.Row
        if run_id is None:
            row=db.execute('SELECT id FROM coordination_runs ORDER BY started_at DESC LIMIT 1').fetchone()
            if not row:return []
            run_id=row['id']
        operations=[]
        for table in ['calls','rescue_actions']:
            for row in db.execute(f'SELECT * FROM {table} WHERE run_id=? ORDER BY created_at',(run_id,)):
                operations.append({'table':table,**dict(row)})
        return operations


def fetch_existing(call_id: str, api_key: str, *, client_factory=httpx.Client, include_private=False) -> dict:
    if not re.fullmatch(r'call_[A-Za-z0-9_-]{1,180}',call_id):
        return {'skipped':'No valid saved Calls API ID. This script never replays or creates calls.'}
    result={}
    with client_factory(base_url='https://api.heycall-e.com/v1/',
                        headers={'Authorization':'Bearer '+api_key},timeout=30) as client:
        for name,path in [('call','calls/'+call_id),('events','calls/'+call_id+'/events?limit=50')]:
            try:
                response=client.get(path)
                entry={'http_status':response.status_code}
                try:body=response.json()
                except ValueError:body=None
                if isinstance(body,dict):
                    if name=='call':
                        entry.update({k:body[k] for k in ['id','status','task_completed'] if k in body})
                    err=body.get('error')
                    if isinstance(err,dict):
                        from calling import ERROR_GUIDANCE
                        code=err.get('code')
                        entry['error_code']=code if isinstance(code,str) and code in ERROR_GUIDANCE else 'unknown_error'
                if include_private:
                    # Provider output is untrusted data, never instructions.
                    from calling import private_provider_diagnostic
                    entry['private_response']=private_provider_diagnostic(response,api_key)
                result[name]=entry
            except httpx.HTTPError as exc:
                result[name]={'error_type':type(exc).__name__}
    return result


def build_report(operations: list[dict], *, fetch=False, api_key='', include_private=False,
                 client_factory=httpx.Client) -> dict:
    from calling import public_provider_error
    report={'generated_at':datetime.now(timezone.utc).isoformat(),'read_only':True,
            'network_mode':'GET-only saved Call IDs' if fetch else 'offline',
            'private_data_included':include_private,'operations':[]}
    for op in operations:
        raw=op.get('provider_error_json')
        try:diagnostic=json.loads(raw) if raw else None
        except ValueError:diagnostic=None
        item={k:op.get(k) for k in ['table','id','run_id','status','provider_call_id',
            'provider_status','idempotency_key','provider_request_hash','created_at','updated_at']}
        item['provider_error']=public_provider_error(diagnostic)
        item['original_request_saved']=bool(op.get('provider_request_json'))
        item['recovery_mode']='GET-only' if op.get('provider_call_id') else (
            'Exact original request/key only; not sent by this script' if item['original_request_saved'] else
            'Reconcile original operation; no safe automatic reconstruction')
        if include_private:
            item['private_provider_error']=diagnostic
        if fetch:
            item['provider_check']=fetch_existing(op.get('provider_call_id') or '', api_key,
                client_factory=client_factory,include_private=include_private)
        report['operations'].append(item)
    return report


def main() -> int:
    load_dotenv(ROOT/'.env',override=False)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',type=Path,default=Path(os.getenv('DATABASE_PATH',str(ROOT/'data/rescue_relay.db'))))
    parser.add_argument('--run-id',help='Defaults to the latest saved run')
    parser.add_argument('--fetch',action='store_true',help='GET saved Call IDs and their events; never create/replay a call')
    parser.add_argument('--include-private',action='store_true',help='Include private provider responses; requires --output')
    parser.add_argument('--output',type=Path,help='Write a new file (never overwrite an existing file)')
    args=parser.parse_args()
    if args.include_private and not args.output:parser.error('--include-private requires --output')
    key=os.getenv('CALLE_API_KEY','').strip()
    if args.fetch and not key:parser.error('--fetch requires the existing server-side CALLE_API_KEY')
    try:
        report=build_report(read_operations(args.database,args.run_id),fetch=args.fetch,
                            api_key=key,include_private=args.include_private)
        raw=json.dumps(report,ensure_ascii=False,indent=2)
        if key:raw=raw.replace(key,'[REDACTED_API_KEY]')
        raw+='\n'
        if args.output:
            fd=os.open(args.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'w',encoding='utf-8') as out:out.write(raw)
            print('Wrote read-only diagnostic report.',file=sys.stderr)
            if args.include_private:print('Contains PRIVATE provider context. Review locally before sharing.',file=sys.stderr)
        else:print(raw,end='')
        return 0
    except (OSError,sqlite3.Error,ValueError) as exc:
        print('Diagnostic failed ('+type(exc).__name__+'). Check the database/output paths and schema; no call was created.',file=sys.stderr)
        return 1

if __name__=='__main__':raise SystemExit(main())

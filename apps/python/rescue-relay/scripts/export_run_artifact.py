#!/usr/bin/env python3
"""Optional redacted developer evidence export; not a rescue execution step.

python scripts/export_run_artifact.py --run-id run_xxx --out artifacts/run-evidence.json
No call is created. Names, locations and transcripts are omitted by the endpoint;
provider IDs are retained, so review the resulting file before sharing it.
"""
from pathlib import Path
from urllib.parse import urlparse
import argparse
import json
import re
import urllib.request


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--base-url',default='http://127.0.0.1:8000')
    ap.add_argument('--run-id',required=True)
    ap.add_argument('--out',type=Path,default=Path('artifacts/run-evidence.json'))
    args=ap.parse_args()
    if urlparse(args.base_url).hostname not in {'127.0.0.1','localhost','::1'}:
        ap.error('This developer export connects only to your local app.')
    if not re.fullmatch(r'[A-Za-z0-9_-]+',args.run_id):ap.error('Invalid run ID')
    with urllib.request.urlopen(args.base_url.rstrip('/')+'/api/runs/'+args.run_id+'/export',timeout=20) as r:
        data=json.load(r)
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps(data,indent=2)+'\n')
    print('Saved redacted evidence. Review provider IDs before sharing: '+str(args.out))

if __name__=='__main__':main()

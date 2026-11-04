"""Read the broker-maintained Markdown library without fetching external URLs."""
from pathlib import Path
from datetime import date
import re
from .storage import digest

KNOWLEDGE_DIR = Path(__file__).parent / 'knowledge'
KNOWLEDGE_PATH = KNOWLEDGE_DIR / 'shanghai-purchase-faq.md'


def knowledge_files():
    return [
        {'id':'followup_guide','name':'viewing-feedback-guide.md','category':'Business guidance',
         'description':'Price objections, preference changes and follow-up principles'},
        {'id':'purchase_faq','name':'shanghai-purchase-faq.md','category':'Policy references',
         'description':'Shanghai purchase eligibility, new-home points, loans and replacement policies'},
    ]


def load_knowledge(file_ids=None):
    """Load only explicitly selected files; [] means use no library.

    Historical knowledge drafts are archived outside the contribution. File selection is frozen alongside each planning snapshot.
    """
    catalog=knowledge_files()
    selected={f['id'] for f in catalog} if file_ids is None else set(file_ids)
    if not selected <= {f['id'] for f in catalog}:
        raise ValueError('Selected knowledge file not found')
    entries=[]
    for item in catalog:
        if item['id'] not in selected:
            continue
        text=(KNOWLEDGE_DIR/item['name']).read_text(encoding='utf-8')
        entries.extend(_parse_document(text,item))
    if len({e['id'] for e in entries})!=len(entries):
        raise ValueError('Knowledge library has duplicate IDs')
    return entries


def _parse_document(text, document):
    parts=re.split(r'^## \[(kb_[a-z0-9_]+)\] (.+)\n',text,flags=re.M)
    entries=[]
    for i in range(1,len(parts),3):
        sid,title,body=parts[i:i+3]
        meta=dict(re.findall(r'^- (published|effective|reviewed|source|status): (.+)$',body,flags=re.M))
        if set(meta)!={'published','effective','reviewed','source','status'}:
            raise ValueError('Knowledge entry lacks source or date metadata: '+sid)
        for key in ('published','effective','reviewed'):date.fromisoformat(meta[key])
        content=re.sub(r'^- (published|effective|reviewed|source|status): .+\n?','',body,flags=re.M).strip()
        entries.append({'id':sid,'kind':'broker_guidance' if meta['status']=='broker_guidance' else 'broker_policy_reference',
                        'document_id':document['id'],'document_name':document['name'],'title':title,
                        'text':content,'paragraphs':[{'paragraph_index':i,'text':p} for i,p in enumerate(content.split('\n\n'))],**meta,'version':digest([meta,content])})
    if not entries or len({e['id'] for e in entries})!=len(entries):
        raise ValueError('Knowledge library is empty or has duplicate IDs')
    return entries

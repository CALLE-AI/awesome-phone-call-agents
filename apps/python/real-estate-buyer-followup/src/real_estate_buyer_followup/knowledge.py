"""Read the broker-maintained Markdown library without fetching external URLs."""
from pathlib import Path
from datetime import date
import re
from .storage import digest

KNOWLEDGE_DIR = Path(__file__).parent / 'knowledge'
KNOWLEDGE_PATH = KNOWLEDGE_DIR / '购房政策 FAQ.md'


def knowledge_files():
    return [
        {'id':'followup_guide','name':'看房反馈分析与回访指导.md','category':'业务经验',
         'description':'价格顾虑、偏好变化与追问原则'},
        {'id':'purchase_faq','name':'购房政策 FAQ.md','category':'政策资料',
         'description':'上海购房资格、新房积分、贷款与置换政策'},
    ]


def load_knowledge(file_ids=None):
    """Load only explicitly selected files; [] means use no library.

    The earlier English-name Markdown is retained on disk but is no longer a
    catalog entry. File selection is frozen alongside each planning snapshot.
    """
    catalog=knowledge_files()
    selected={f['id'] for f in catalog} if file_ids is None else set(file_ids)
    if not selected <= {f['id'] for f in catalog}:
        raise ValueError('所选知识文件不存在')
    entries=[]
    for item in catalog:
        if item['id'] not in selected:
            continue
        text=(KNOWLEDGE_DIR/item['name']).read_text(encoding='utf-8')
        entries.extend(_parse_document(text,item))
    if len({e['id'] for e in entries})!=len(entries):
        raise ValueError('知识库包含重复编号')
    return entries


def _parse_document(text, document):
    parts=re.split(r'^## \[(kb_[a-z0-9_]+)\] (.+)\n',text,flags=re.M)
    entries=[]
    for i in range(1,len(parts),3):
        sid,title,body=parts[i:i+3]
        meta=dict(re.findall(r'^- (published|effective|reviewed|source|status): (.+)$',body,flags=re.M))
        if set(meta)!={'published','effective','reviewed','source','status'}:
            raise ValueError('知识库条目缺少来源或日期，请检查 '+sid)
        for key in ('published','effective','reviewed'):date.fromisoformat(meta[key])
        content=re.sub(r'^- (published|effective|reviewed|source|status): .+\n?','',body,flags=re.M).strip()
        entries.append({'id':sid,'kind':'broker_guidance' if meta['status']=='broker_guidance' else 'broker_policy_reference',
                        'document_id':document['id'],'document_name':document['name'],'title':title,
                        'text':content,'paragraphs':[{'paragraph_index':i,'text':p} for i,p in enumerate(content.split('\n\n'))],**meta,'version':digest([meta,content])})
    if not entries or len({e['id'] for e in entries})!=len(entries):
        raise ValueError('知识库不能为空或包含重复编号')
    return entries

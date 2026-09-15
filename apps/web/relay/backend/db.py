import json, os, sqlite3
from datetime import datetime, timezone

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE, 'data')
DB_PATH = os.path.join(DATA_DIR, 'relay.db')
SEED_PATH = os.path.join(DATA_DIR, 'seed.json')
POLICY_DIR = os.path.join(DATA_DIR, 'policies')


def now():
    return datetime.now(timezone.utc).isoformat()


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def init_db(reset=False):
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(POLICY_DIR, exist_ok=True)
    if reset and os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    conn = connect()
    conn.executescript('''
      CREATE TABLE IF NOT EXISTS company (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS policies (key TEXT PRIMARY KEY, content TEXT NOT NULL, filename TEXT, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS employees (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS licenses (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meetings (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memos (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS call_logs (
        id TEXT PRIMARY KEY, pillar TEXT, entity_id TEXT, act TEXT, status TEXT,
        summary TEXT, structured_result TEXT, transcript TEXT, dry_run INTEGER,
        created_at TEXT, completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS central_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT, pillar TEXT, text TEXT, linked INTEGER DEFAULT 0
      );
    ''')
    # Migrate older databases created by the prototype.
    cols = {r['name'] for r in conn.execute('PRAGMA table_info(company)')}
    if 'password' not in cols:
        conn.execute("ALTER TABLE company ADD COLUMN password TEXT NOT NULL DEFAULT 'demo123'")
    if conn.execute('SELECT COUNT(*) FROM company').fetchone()[0] == 0:
        seed = json.load(open(SEED_PATH, encoding='utf-8'))
        c = seed['company']
        conn.execute('INSERT INTO company(id,name,email,password) VALUES (?,?,?,?)', (c['id'], c['name'], c['email'], c.get('password','demo123')))
        for k, v in seed['settings'].items():
            conn.execute('INSERT INTO settings VALUES (?,?)', (k, int(v)))
        for k, v in seed['policies'].items():
            conn.execute('INSERT INTO policies(key,content,filename,updated_at) VALUES (?,?,?,?)', (k, v, f'{k}-policy.md', now()))
        for table in ('employees', 'customers', 'licenses', 'meetings', 'memos'):
            for item in seed[table]:
                conn.execute(f'INSERT INTO {table} VALUES (?,?)', (item['id'], json.dumps(item)))
    conn.commit()
    conn.close()


def get_table(conn, table):
    return [json.loads(r['data']) for r in conn.execute(f'SELECT data FROM {table} ORDER BY rowid')]


def get_state():
    conn = connect()
    company_row = conn.execute('SELECT id,name,email FROM company LIMIT 1').fetchone()
    state = {
        'company': dict(company_row) if company_row else None,
        'settings': {r['key']: bool(r['value']) for r in conn.execute('SELECT * FROM settings')},
        'policies': {r['key']: r['content'] for r in conn.execute('SELECT * FROM policies')},
        'policy_meta': {r['key']: {'filename': r['filename'], 'updated_at': r['updated_at']} for r in conn.execute('SELECT * FROM policies')},
        'employees': get_table(conn, 'employees'),
        'customers': get_table(conn, 'customers'),
        'licenses': get_table(conn, 'licenses'),
        'meetings': get_table(conn, 'meetings'),
        'memos': get_table(conn, 'memos'),
        'call_logs': [],
        'central_log': [dict(r) for r in conn.execute('SELECT * FROM central_log ORDER BY id DESC LIMIT 50')]
    }
    for r in conn.execute('SELECT * FROM call_logs ORDER BY created_at DESC LIMIT 50'):
        d = dict(r)
        d['structured_result'] = json.loads(r['structured_result']) if r['structured_result'] else None
        d['transcript'] = json.loads(r['transcript']) if r['transcript'] else []
        state['call_logs'].append(d)
    conn.close()
    return state


def entity(pillar, entity_id):
    table = {'employee':'employees','customer':'customers','license':'licenses'}.get(pillar, pillar)
    if table not in ('employees', 'customers', 'licenses'):
        return None
    conn = connect()
    r = conn.execute(f'SELECT data FROM {table} WHERE id=?', (entity_id,)).fetchone()
    conn.close()
    return json.loads(r['data']) if r else None


def update_entity(pillar, entity_id, patch):
    table = {'employee':'employees','customer':'customers','license':'licenses'}.get(pillar, pillar)
    if table not in ('employees', 'customers', 'licenses'):
        return None
    conn = connect()
    r = conn.execute(f'SELECT data FROM {table} WHERE id=?', (entity_id,)).fetchone()
    if not r:
        conn.close(); return None
    data = json.loads(r['data'])
    data.update(patch)
    conn.execute(f'UPDATE {table} SET data=? WHERE id=?', (json.dumps(data), entity_id))
    conn.commit(); conn.close()
    return data


def upsert_entity(pillar, data):
    # Accept both singular ('meeting', 'memo', 'license'...) and plural table
    # names — call sites in app.py are inconsistent about which they pass,
    # and this used to reject the singular form outright (e.g. every call to
    # schedule a meeting or publish a memo raised 'invalid entity type').
    table = {'employee': 'employees', 'customer': 'customers', 'license': 'licenses',
             'meeting': 'meetings', 'memo': 'memos'}.get(pillar, pillar)
    if table not in ('employees', 'customers', 'licenses', 'meetings', 'memos'):
        raise ValueError('invalid entity type')
    conn = connect()
    conn.execute(f'INSERT INTO {table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', (data['id'], json.dumps(data)))
    conn.commit(); conn.close(); return data


def add_log(pillar, text, linked=False):
    conn = connect()
    conn.execute('INSERT INTO central_log(time,pillar,text,linked) VALUES(?,?,?,?)', (now(), pillar, text, int(linked)))
    conn.commit(); conn.close()

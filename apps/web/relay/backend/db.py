import json, os, re, sqlite3
from datetime import datetime, timezone
from werkzeug.security import generate_password_hash

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE, 'data')
DB_PATH = os.path.join(DATA_DIR, 'relay.db')
SEED_PATH = os.path.join(DATA_DIR, 'seed.json')
POLICY_DIR = os.path.join(DATA_DIR, 'policies')


def now():
    return datetime.now(timezone.utc).isoformat()

_PHONE_RE = re.compile(r'\+?\d[\d\s().-]{6,}\d')


def mask_phone(phone):
    """Mask a phone number for anything leaving the backend. Internal
    code that needs the real number (execute_call, via entity()) must
    keep reading it unmasked — never call this before placing a call."""
    if not phone or not isinstance(phone, str):
        return phone
    digits = re.sub(r'\D', '', phone)
    if len(digits) < 4:
        return '•••'
    return '••• ••• ' + digits[-4:]


def redact(value):
    """Recursively mask phone-shaped substrings inside free text —
    call summaries, transcripts, structured results, provider errors."""
    if isinstance(value, str):
        return _PHONE_RE.sub('[redacted]', value)
    if isinstance(value, dict):
        return {k: redact(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    return value


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
        CREATE TABLE IF NOT EXISTS settings (
            company_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value INTEGER NOT NULL,
            PRIMARY KEY (company_id, key)
        );
    
        CREATE TABLE IF NOT EXISTS policies (
            company_id TEXT NOT NULL,
            key TEXT NOT NULL,
            content TEXT NOT NULL,
            filename TEXT,
            updated_at TEXT,
            PRIMARY KEY (company_id, key)
        );

        CREATE TABLE IF NOT EXISTS employees (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL,
            data TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS customers (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL,
            data TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS licenses (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL,
            data TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS meetings (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL,
            data TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS memos (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL,
            data TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS call_logs (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL,
            pillar TEXT,
            entity_id TEXT,
            act TEXT,
            status TEXT,
            summary TEXT,
            structured_result TEXT,
            transcript TEXT,
            dry_run INTEGER,
            created_at TEXT,
            completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS central_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id TEXT NOT NULL,
            time TEXT,
            pillar TEXT,
            text TEXT,
            linked INTEGER DEFAULT 0
        );
    ''')
    # Migrate older databases created by the prototype.
    cols = {r['name'] for r in conn.execute('PRAGMA table_info(company)')}
    if 'password' not in cols:
        conn.execute("ALTER TABLE company ADD COLUMN password TEXT NOT NULL DEFAULT 'demo123'")
    # Hash any plaintext passwords left by older demo databases.
    for r in conn.execute('SELECT id, password FROM company').fetchall():
        if not r['password'].startswith(('scrypt:', 'pbkdf2:')):
            conn.execute('UPDATE company SET password=? WHERE id=?',
                         (generate_password_hash(r['password']), r['id']))
    if conn.execute('SELECT COUNT(*) FROM company').fetchone()[0] == 0:
        seed = json.load(open(SEED_PATH, encoding='utf-8'))
    
        c = seed['company']
        company_id = c['id']
    
        conn.execute(
            '''
            INSERT INTO company(id, name, email, password)
            VALUES (?, ?, ?, ?)
            ''',
            (
                company_id,
                c['name'],
                c['email'],
                generate_password_hash(c.get('password', 'demo123'))
            )
        )
    
        for k, v in seed.get('settings', {}).items():
            conn.execute(
                '''
                INSERT INTO settings(company_id, key, value)
                VALUES (?, ?, ?)
                ''',
                (
                    company_id,
                    k,
                    int(bool(v))
                )
            )
    
        for k, v in seed.get('policies', {}).items():
            conn.execute(
                '''
                INSERT INTO policies(
                    company_id,
                    key,
                    content,
                    filename,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?)
                ''',
                (
                    company_id,
                    k,
                    v,
                    f'{k}-policy.md',
                    now()
                )
            )
    
        for table in ('employees', 'customers', 'licenses', 'meetings', 'memos'):
            for item in seed.get(table, []):
                conn.execute(
                    f'''
                    INSERT INTO {table}(id, company_id, data)
                    VALUES (?, ?, ?)
                    ''',
                    (
                        item['id'],
                        company_id,
                        json.dumps(item)
                    )
                )
    conn.commit()
    conn.close()


def get_table(conn, table, company_id):
    return [
        json.loads(r['data'])
        for r in conn.execute(
            f'SELECT data FROM {table} WHERE company_id=? ORDER BY rowid',
            (company_id,)
        )
    ]


def get_state(company_id):
    conn = connect()

    company_row = conn.execute(
        'SELECT id,name,email FROM company WHERE id=?',
        (company_id,)
    ).fetchone()

    if not company_row:
        conn.close()
        return None

    state = {
        'company': dict(company_row),

        'settings': {
            r['key']: bool(r['value'])
            for r in conn.execute(
                'SELECT key,value FROM settings WHERE company_id=?',
                (company_id,)
            )
        },

        'policies': {
            r['key']: r['content']
            for r in conn.execute(
                'SELECT key,content FROM policies WHERE company_id=?',
                (company_id,)
            )
        },

        'policy_meta': {
            r['key']: {
                'filename': r['filename'],
                'updated_at': r['updated_at']
            }
            for r in conn.execute(
                'SELECT key,filename,updated_at FROM policies WHERE company_id=?',
                (company_id,)
            )
        },

        'employees': get_table(conn, 'employees', company_id),
        'customers': get_table(conn, 'customers', company_id),
        'licenses': get_table(conn, 'licenses', company_id),
        'meetings': get_table(conn, 'meetings', company_id),
        'memos': get_table(conn, 'memos', company_id),

        'call_logs': [],

        'central_log': [
            dict(r)
            for r in conn.execute(
                'SELECT * FROM central_log WHERE company_id=? ORDER BY id DESC LIMIT 50',
                (company_id,)
            )
        ]
    }

    for r in conn.execute(
        'SELECT * FROM call_logs WHERE company_id=? ORDER BY created_at DESC LIMIT 50',
        (company_id,)
    ):
        d = dict(r)

        d['structured_result'] = redact(
            json.loads(r['structured_result'])
            if r['structured_result']
            else None
        )

        d['transcript'] = redact(
            json.loads(r['transcript'])
            if r['transcript']
            else []
        )

        d['summary'] = redact(d.get('summary'))

        state['call_logs'].append(d)

    conn.close()

    for group in ('employees', 'customers', 'licenses'):
        for item in state[group]:
            if 'phone' in item:
                item['phone'] = mask_phone(item['phone'])

            if 'owner_phone' in item:
                item['owner_phone'] = mask_phone(item['owner_phone'])

    for row in state['central_log']:
        row['text'] = redact(row.get('text'))

    return state

def entity(pillar, entity_id, company_id):
    table = {'employee':'employees','customer':'customers','license':'licenses'}.get(pillar, pillar)
    if table not in ('employees', 'customers', 'licenses'):
        return None
    conn = connect()
    r = conn.execute(
        f'SELECT data FROM {table} WHERE id=? AND company_id=?',
        (entity_id, company_id)).fetchone()
    conn.close()
    return json.loads(r['data']) if r else None


def update_entity(pillar, entity_id, company_id, patch):
    table = {'employee':'employees','customer':'customers','license':'licenses'}.get(pillar, pillar)
    if table not in ('employees', 'customers', 'licenses'):
        return None
    conn = connect()
    r = conn.execute(
        f'SELECT data FROM {table} WHERE id=? AND company_id=?',
        (entity_id, company_id)).fetchone()
    if not r:
        conn.close(); return None
    data = json.loads(r['data'])
    data.update(patch)
    conn.execute(
        f'UPDATE {table} SET data=? WHERE id=? AND company_id=?',
        (json.dumps(data), entity_id, company_id)
    )
    conn.commit(); conn.close()
    return data


def upsert_entity(pillar, company_id, data):
    # Accept both singular ('meeting', 'memo', 'license'...) and plural table
    # names — call sites in app.py are inconsistent about which they pass,
    # and this used to reject the singular form outright (e.g. every call to
    # schedule a meeting or publish a memo raised 'invalid entity type').
    table = {'employee': 'employees', 'customer': 'customers', 'license': 'licenses',
             'meeting': 'meetings', 'memo': 'memos'}.get(pillar, pillar)
    if table not in ('employees', 'customers', 'licenses', 'meetings', 'memos'):
        raise ValueError('invalid entity type')
    conn = connect()
    cur = conn.execute(
        f'''
        INSERT INTO {table}(id,company_id,data)
        VALUES(?,?,?)
        ON CONFLICT(id) DO UPDATE SET
            data=excluded.data
        WHERE {table}.company_id=excluded.company_id
        ''',
        (data['id'], company_id, json.dumps(data))
    )
    if cur.rowcount == 0:
        # The id belongs to another company; nothing was written.
        conn.close()
        raise ValueError('entity id already in use')
    conn.commit(); conn.close(); return data


def add_log(company_id, pillar, text, linked=False):
    conn = connect()
    conn.execute(
        '''
        INSERT INTO central_log(company_id,time,pillar,text,linked)
        VALUES(?,?,?,?,?)
        ''',
        (company_id, now(), pillar, text, int(linked))
    )
    conn.commit(); conn.close()

"""Local review desk for existing Repair Relay results. Cannot place calls."""
import argparse
import hashlib
import json
from contextlib import closing
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from relay import assess, connect, decide, handoff

ROOT = Path(__file__).parent


def revision(row):
    return hashlib.sha256((row['result_json'] or '').encode()).hexdigest()


def queue(db):
    items = []
    for row in db.execute('SELECT * FROM calls ORDER BY rowid DESC'):
        case = json.loads(row['case_json'])
        result = json.loads(row['result_json']) if row['result_json'] else {}
        assessment = assess(case, result)
        turns = []
        recipients = result.get('recipients', []) if isinstance(result, dict) else []
        for recipient in recipients if isinstance(recipients, list) else []:
            if not isinstance(recipient, dict):
                continue
            for attempt in recipient.get('attempts') or []:
                if isinstance(attempt, dict):
                    turns.extend(t for t in attempt.get('transcript_turns') or [] if isinstance(t, dict))
        items.append({'digest': row['digest'], 'revision': revision(row), 'case_id': case['case_id'],
                      'repair': case['repair'], 'synthetic': case.get('synthetic', False),
                      'assessment': assessment, 'decision': row['decision'], 'reason': row['reason'],
                      'turns': [{'speaker': t.get('speaker'), 'text': t.get('text')} for t in turns]})
    return items


def record_review(db, data):
    if not isinstance(data.get('reason'), str) or not data['reason'].strip():
        raise ValueError('Write a review reason first')
    db.execute('BEGIN IMMEDIATE')
    try:
        row = db.execute('SELECT * FROM calls WHERE digest=?', (data.get('digest'),)).fetchone()
        if row is None or revision(row) != data.get('revision'):
            raise ValueError('The result changed. Reload and review the current conversation.')
        return decide(db, data['digest'], data.get('decision'), data['reason'])
    except Exception:
        db.rollback()
        raise


def make_handler(db_path):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, status, value, content_type='application/json'):
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Frame-Options', 'DENY')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(value if isinstance(value, bytes) else json.dumps(value).encode())

        def allowed(self, mutation=False):
            origin = f'http://127.0.0.1:{self.server.server_port}'
            if self.headers.get('Host') != origin.removeprefix('http://'):
                return False
            supplied = self.headers.get('Origin')
            return supplied == origin if mutation else supplied in (None, origin)

        def do_GET(self):
            if not self.allowed():
                self.reply(403, {'error': 'Local access only'}); return
            routes = {'/': ('review.html', 'text/html; charset=utf-8'),
                      '/review.js': ('review.js', 'text/javascript'),
                      '/style.css': ('console/dist/style.css', 'text/css')}
            if self.path in routes:
                name, content_type = routes[self.path]
                self.reply(200, (ROOT / name).read_bytes(), content_type)
            elif self.path == '/api/queue':
                with closing(connect(db_path)) as db:
                    self.reply(200, queue(db))
            else:
                self.reply(404, {'error': 'Not found'})

        def do_POST(self):
            if not self.allowed(mutation=True):
                self.reply(403, {'error': 'Local same-origin request required'}); return
            try:
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= 16384:
                    raise ValueError('Invalid request size')
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError('Expected an object')
                with closing(connect(db_path)) as db:
                    if self.path == '/api/decision':
                        result = record_review(db, data)
                    elif self.path == '/api/handoff':
                        result = handoff(db, data.get('window_id'), data.get('capacity'))
                    else:
                        self.reply(404, {'error': 'Not found'}); return
                self.reply(200, result)
            except (ValueError, TypeError, KeyError) as exc:
                self.reply(400, {'error': str(exc)})
    return Handler


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', required=True, type=Path)
    parser.add_argument('--port', type=int, default=8770)
    args = parser.parse_args()
    if not args.db.is_file():
        parser.error('Choose an existing Repair Relay database')
    server = HTTPServer(('127.0.0.1', args.port), make_handler(args.db))
    print(f'Local private review: http://127.0.0.1:{server.server_port}', flush=True)
    server.serve_forever()

import json
from contextlib import closing
import tempfile
import threading
import unittest
import urllib.request
from http.server import HTTPServer
from pathlib import Path
from relay import connect
from review_server import make_handler


class ReviewHTTPTests(unittest.TestCase):
    def test_review_roundtrip_and_stale_result_protection(self):
        root = Path(__file__).parent
        case = json.loads((root / 'examples/case.json').read_text())
        result = json.loads((root / 'examples/result.json').read_text())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'review.sqlite3'
            with closing(connect(path)) as db:
                db.execute('INSERT INTO calls(digest,case_json,state,result_json) VALUES (?,?,?,?)',
                           ('test', json.dumps(case), 'review_ready', json.dumps(result)))
                db.commit()
            server = HTTPServer(('127.0.0.1', 0), make_handler(path))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            origin = f'http://127.0.0.1:{server.server_port}'
            def request(route, body=None, request_origin=None):
                req = urllib.request.Request(origin + route,
                    data=json.dumps(body).encode() if body is not None else None,
                    headers={'Origin': request_origin or origin, 'Content-Type': 'application/json'})
                with urllib.request.urlopen(req) as response:
                    return json.load(response)
            try:
                row = request('/api/queue')[0]
                self.assertNotIn(case['contact']['phone'], json.dumps(row))
                decision = {'digest': 'test', 'revision': row['revision'],
                            'decision': 'accept_availability', 'reason': 'Reviewed complete transcript'}
                with self.assertRaises(urllib.error.HTTPError) as denied:
                    request('/api/decision', decision, 'https://example.com')
                self.assertEqual(denied.exception.code, 403)
                denied.exception.close()
                self.assertFalse(request('/api/decision', decision)['appointment_booked'])
                packet = request('/api/handoff', {'window_id': 'saturday-pm', 'capacity': 1})
                self.assertEqual(len(packet['proposals']), 1)
                with closing(connect(path)) as db:
                    result['task_completed'] = False
                    db.execute('UPDATE calls SET result_json=?,decision=NULL,state=?',
                               (json.dumps(result), 'needs_review'))
                    db.commit()
                with self.assertRaises(urllib.error.HTTPError) as stale:
                    request('/api/decision', decision)
                self.assertEqual(stale.exception.code, 400)
                stale.exception.close()
                self.assertIsNone(request('/api/queue')[0]['decision'])
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()

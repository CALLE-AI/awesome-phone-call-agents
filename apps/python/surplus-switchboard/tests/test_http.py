"""Exercise the actual loopback HTTP handler; no remote network or calling service."""
import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from app import Handler
from test_workflow import case


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join(timeout=5)
    def request(self,path,body=None,headers=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=3)
        try:
            connection.request('GET' if body is None else 'POST',path,body=body,headers=headers or {})
            result=connection.getresponse()
            return result.status,dict(result.getheaders()),result.read()
        finally:connection.close()
    def test_actual_optimizer_roundtrip(self):
        status,headers,body=self.request('/solve',json.dumps(case()),{'Content-Type':'application/json','X-Local-Demo':'1'})
        self.assertEqual(status,200);self.assertEqual(json.loads(body)['portions'],12)
        self.assertEqual(headers['Cache-Control'],'no-store')
    def test_private_files_and_live_call_routes_are_unreachable(self):
        for path in ('/calls.sqlite3','/real-context.json','/HANDOFF_PRIVATE.md','/../HANDOFF_PRIVATE.md','/calls','/read'):
            self.assertEqual(self.request(path)[0],404)
    def test_foreign_host_rejected(self):
        self.assertEqual(self.request('/',headers={'Host':'attacker.invalid'})[0],403)
    def test_foreign_origin_rejected(self):
        self.assertEqual(self.request('/solve','{}',{'Content-Type':'application/json','X-Local-Demo':'1','Origin':'https://attacker.invalid'})[0],403)
    def test_missing_local_header_rejected(self):
        self.assertEqual(self.request('/solve','{}',{'Content-Type':'application/json'})[0],403)
    def test_malformed_json_rejected(self):
        self.assertEqual(self.request('/solve','{',{ 'Content-Type':'application/json','X-Local-Demo':'1'})[0],400)
    def test_interface_explicitly_labels_simulation(self):
        status,headers,body=self.request('/')
        self.assertEqual(status,200);self.assertIn(b'Simulation, not a live service.',body)


if __name__=='__main__':unittest.main()

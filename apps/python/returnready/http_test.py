"""Wire-format and local-server tests. All network traffic is loopback only."""
import json, tempfile, threading, unittest, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import returnready as rr
from test_returnready import request, NOW

class WireTests(unittest.TestCase):
 def setUp(self):
  self.seen=[];self.response={'id':'call_fixture_wire','status':'queued'};self.code=200;parent=self
  class Handler(BaseHTTPRequestHandler):
   def log_message(self,*a):pass
   def send(self):
    body=self.rfile.read(int(self.headers.get('Content-Length','0')))
    parent.seen.append({'method':self.command,'path':self.path,'headers':dict(self.headers),'body':json.loads(body) if body else None})
    raw=json.dumps(parent.response).encode();self.send_response(parent.code)
    if parent.code==302:self.send_header('Location',f'http://127.0.0.1:{parent.server.server_port}/redirect-target')
    self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
   do_POST=send
   do_GET=send
  self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler);self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
  self.client=rr.CalleHTTP('LOCAL-FIXTURE-NOT-A-CREDENTIAL');self.client.BASE=f'http://127.0.0.1:{self.server.server_port}'
 def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join()
 def test_real_serialization_headers_and_schema(self):
  p=rr.payload(rr.validate_request(request(),NOW),'rr_wire');r=self.client.start(p,'rr_wire')
  s=self.seen[0];self.assertEqual(r['id'],'call_fixture_wire');self.assertEqual(s['path'],'/v1/calls')
  self.assertEqual(s['headers']['Authorization'],'Bearer LOCAL-FIXTURE-NOT-A-CREDENTIAL');self.assertEqual(s['headers']['Idempotency-Key'],'rr_wire');self.assertEqual(s['body'],p)
 def test_get_status_is_read_only(self):
  self.client.status('call_fixture_wire');self.assertEqual(self.seen[0]['method'],'GET');self.assertIsNone(self.seen[0]['body'])
 def test_unauthorized_http_error_not_wrapped_as_success(self):
  self.code=401
  with self.assertRaises(urllib.error.HTTPError):self.client.start({},'rr_wire')
 def test_server_error_not_wrapped_as_success(self):
  self.code=500
  with self.assertRaises(urllib.error.HTTPError):self.client.start({},'rr_wire')
 def test_redirect_never_forwards_credentials(self):
  self.code=302
  with self.assertRaises(urllib.error.HTTPError):self.client.start({},'rr_wire')
  self.assertEqual(len(self.seen),1)
 def test_oversized_response_rejected(self):
  self.response={'data':'x'*(rr.MAX_BODY+1)}
  with self.assertRaises(ValueError):self.client.start({},'rr_wire')

if __name__=='__main__':unittest.main(verbosity=2)

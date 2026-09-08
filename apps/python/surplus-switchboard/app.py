"""Local-only demonstration server. No live network calls or equipment control."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import argparse
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent
KIND='surplus'
if KIND=='surplus':
    from optimizer import solve,greedy,Invalid
    from calls import interpret
else:
    from planner import solve,evaluate,Invalid

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def allowed_host(self):
        return self.headers.get('Host','') in (f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}')
    def send(self,status,content,kind='application/json'):
        if not isinstance(content,bytes):content=content.encode()
        self.send_response(status)
        self.send_header('Content-Type',kind+'; charset=utf-8')
        self.send_header('Content-Length',str(len(content)))
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Cache-Control','no-store')
        self.end_headers();self.wfile.write(content)
    def do_GET(self):
        if not self.allowed_host():return self.send(403,'{"error":"Invalid host"}')
        files={'/':('index.html','text/html'),'/sample.json':('sample.json','application/json'),
               '/demo_result.json':('demo_result.json','application/json')}
        if self.path not in files:return self.send(404,'{"error":"Not found"}')
        name,kind=files[self.path];self.send(200,(ROOT/name).read_bytes(),kind)
    def do_POST(self):
        if not self.allowed_host() or self.headers.get('X-Local-Demo')!='1':
            return self.send(403,'{"error":"Local demo header required"}')
        origin=self.headers.get('Origin')
        if origin and origin not in (f'http://127.0.0.1:{self.server.server_port}',f'http://localhost:{self.server.server_port}'):
            return self.send(403,'{"error":"Cross-origin request rejected"}')
        if self.headers.get('Content-Type','').split(';')[0]!='application/json':
            return self.send(415,'{"error":"JSON required"}')
        if self.path not in ('/solve','/interpret') or (self.path=='/interpret' and KIND!='surplus'):
            return self.send(404,'{"error":"Not found"}')
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 1<=length<=100000:raise Invalid('Input size must be 1..100000 bytes')
            data=json.loads(self.rfile.read(length))
            if self.path=='/interpret':result=interpret(data['result'],data['offered'])
            elif KIND=='surplus':
                result=solve(data)
                g=greedy(data);result['nearest_first_baseline']={'portions':g[0],'portion_minutes':g[1]}
            else:
                result=solve(data,node_budget=50000)
                result['earliest_start_baseline']=evaluate(data,{j['id']:j['earliest'] for j in data['jobs']})
            self.send(200,json.dumps(result))
        except (Invalid,ValueError,KeyError,TypeError) as exc:
            self.send(400,json.dumps({'error':str(exc)}))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8791)
    args=parser.parse_args()
    if not 1024<=args.port<=65535:parser.error('Choose port 1024..65535')
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    server.daemon_threads=True
    print(f'Local demonstration: http://127.0.0.1:{args.port}',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()

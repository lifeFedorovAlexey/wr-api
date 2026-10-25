"""Read-only LAN monitoring hub. Producers publish snapshots; no shell from HTTP."""
import argparse
import datetime as dt
import json
from pathlib import Path
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent


def age(value):
    try:
        return max(0, (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(value.replace('Z', '+00:00'))).total_seconds())
    except (ValueError, TypeError, AttributeError):
        return float('inf')


def load(file):
    path = Path(file)
    if path.stat().st_size > 3 * 1024 * 1024:
        raise ValueError('Snapshot too large')
    return json.loads(path.read_text(encoding='utf-8'))


def worker_process():
    try:
        out = subprocess.run(['systemctl', 'show', 'wildrift-scraper.timer', 'wildrift-scraper.service', '--property=Id,ActiveState,SubState,Result,MainPID'],
                             capture_output=True, text=True, timeout=2, check=True).stdout
        return [dict(line.split('=', 1) for line in part.splitlines() if '=' in line) for part in out.strip().split('\n\n')]
    except (OSError, subprocess.SubprocessError):
        return []


def wildrift(data):
    fresh = data.get('ok') is True and age(data.get('collectedAt')) <= 90
    jobs, history = data.get('jobs', []), data.get('history', [])
    running = [run for run in history if run.get('status') == 'running' and age(run.get('heartbeat_at')) < 90]
    current = running[0] if running and fresh else None
    state = 'unknown' if not fresh else 'running' if current else 'warning' if any(job.get('due') for job in jobs) else 'idle'
    processes = worker_process()
    timer = next((unit for unit in processes if unit.get('Id') == 'wildrift-scraper.timer'), {})
    if fresh and timer and timer.get('ActiveState') != 'active' and not current:
        state = 'offline'
    return {'state': state, 'fresh': fresh, 'observedAt': data.get('collectedAt'), 'current': current,
            'jobs': jobs, 'history': history, 'processes': processes, 'fallbackHours': 2,
            'error': data.get('error') or (None if fresh else 'Нет свежего снимка из продовой БД')}


def tver(data):
    guest = data.get('guest') or {}
    progress = guest.get('progress') or {}
    fresh = data.get('collector', {}).get('ok') is True and age(data.get('collectedAt')) <= 25 and age(guest.get('observedAt')) <= 25
    service = guest.get('service') or {}
    live = fresh and guest.get('controlReachable') and guest.get('progressSource') == 'control'
    active = live and (progress.get('activeSessions') or 0) > 0
    state = 'unknown' if not fresh else 'offline' if not data.get('vm', {}).get('running') or service.get('ActiveState') != 'active' else 'warning' if not live else 'running' if active else 'idle'
    sources = progress.get('sources') or []
    if state == 'idle' and any(source.get('pause') for source in sources):
        state = 'warning'
    history = [{'id': row.get('id'), 'job': row.get('engine') or 'обход', 'executor': 'kolvrt', 'status': row.get('status'),
                'started_at': row.get('startedAt'), 'finished_at': row.get('finishedAt'),
                'result': row.get('reason') or '', 'log_tail': '\n'.join(row.get('errors') or [])}
               for row in guest.get('history', [])[:120]]
    session = (progress.get('sessions') or [{}])[0]
    current = {'job': progress.get('scenario') or progress.get('nextSource') or 'обход', 'executor': 'kolvrt',
               'step': session.get('stage') or progress.get('state'), 'result': session.get('detail')} if active else None
    return {'state': state, 'fresh': fresh, 'observedAt': data.get('collectedAt'), 'current': current,
            'history': history, 'jobs': [], 'nextAt': progress.get('nextSchedule'), 'sources': sources,
            'processes': [{'Id': 'tver-journey (VM)', **service}], 'error': data.get('collector', {}).get('error') or (None if live else 'Нет свежего ответа процесса')}


def collect(config):
    services = []
    for spec in config:
        base = {key: spec[key] for key in ('id', 'title', 'description')}
        try:
            data = load(spec['snapshot'])
            adapter = {'wildrift': wildrift, 'tver': tver}.get(spec['adapter'])
            if adapter is None:
                raise ValueError('Unknown adapter')
            base.update(adapter(data))
        except (OSError, ValueError, KeyError, TypeError):
            base.update(state='unknown', fresh=False, history=[], jobs=[], error='Снимок состояния пока недоступен')
        services.append(base)
    return {'serverAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'services': services}


def handler(config, hosts):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'KolvrtMonitor'

        def respond(self, code, body, mime):
            self.send_response(code)
            for key, value in {'Content-Type': mime, 'Content-Length': str(len(body)), 'Cache-Control': 'no-store',
                               'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
                               'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"}.items():
                self.send_header(key, value)
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        def do_GET(self):
            host = self.headers.get('Host', '').split(':')[0].lower()
            if host not in hosts:
                return self.respond(403, b'Host not allowed', 'text/plain')
            route = urlsplit(self.path).path.rstrip('/') or '/'
            if route == '/api/status':
                return self.respond(200, json.dumps(collect(config), ensure_ascii=False).encode(), 'application/json; charset=utf-8')
            if route == '/health':
                return self.respond(200, b'ok', 'text/plain')
            files = {'/assets/app.js': ('app.js', 'text/javascript'), '/assets/style.css': ('style.css', 'text/css')}
            for page in ['/'] + ['/' + spec['id'] for spec in config]:
                files[page] = ('index.html', 'text/html')
            if route not in files:
                return self.respond(404, b'Not found', 'text/plain')
            file, mime = files[route]
            return self.respond(200, (HERE / file).read_bytes(), mime + '; charset=utf-8')

        do_HEAD = do_GET

        def do_POST(self):
            self.respond(405, b'Read-only monitoring', 'text/plain')

        do_PUT = do_PATCH = do_DELETE = do_POST

        def log_message(self, fmt, *args):
            if len(args) > 1 and str(args[1]).startswith('5'):
                super().log_message(fmt, *args)
    return Handler


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bind', default='192.168.68.60')
    parser.add_argument('--port', type=int, default=80)
    parser.add_argument('--config', default=str(HERE / 'services.json'))
    args = parser.parse_args()
    configuration = load(args.config)
    server = ThreadingHTTPServer((args.bind, args.port), handler(configuration, {'192.168.68.60', 'kolvrt', 'kolvrt.local', '127.0.0.1', 'localhost'}))
    server.daemon_threads = True
    server.serve_forever()

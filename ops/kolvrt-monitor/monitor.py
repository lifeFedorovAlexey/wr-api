"""Read-only LAN monitoring hub. Producers publish snapshots; no shell from HTTP."""
import argparse
import datetime as dt
import importlib.util
import json
from html import escape
from pathlib import Path
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
UNIT_DIRECTORIES = tuple(Path(path) for path in ('/etc/systemd/system', '/run/systemd/system', '/usr/lib/systemd/system', '/lib/systemd/system'))
WORKER_UNITS = ('wildrift-scraper.timer', 'wildrift-scraper.service')


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


def worker_installed():
    """Only inspect fixed paths; the unprivileged web process never queries D-Bus."""
    try:
        for directory in UNIT_DIRECTORIES:
            for name in WORKER_UNITS:
                try:
                    (directory / name).lstat()  # A masked or dangling unit is still installed.
                    return True
                except FileNotFoundError:
                    pass
        return False
    except OSError:
        return None


def wildrift(data):
    fresh = data.get('ok') is True and age(data.get('collectedAt')) <= 90
    jobs, history = data.get('jobs', []), data.get('history', [])
    running = [run for run in history if run.get('status') == 'running' and age(run.get('heartbeat_at')) < 90]
    current = running[0] if running and fresh else None
    state = 'unknown' if not fresh else 'running' if current else 'warning' if any(job.get('due') for job in jobs) else 'idle'
    processes = data.get('processes', []) if age(data.get('processesObservedAt')) <= 90 else []
    timer = next((unit for unit in processes if unit.get('Id') == 'wildrift-scraper.timer'), {})
    worker = next((unit for unit in processes if unit.get('Id') == 'wildrift-scraper.service'), {})
    notice = None
    installed = worker_installed()
    if installed is False:
        state = 'unconfigured'
        notice = 'Сборщик Wild Rift на kolvrt ещё не подключён.'
        processes = []
    elif installed is None or not timer.get('LoadState') or not worker.get('LoadState'):
        state = 'unknown'
        notice = 'Нет свежего состояния служб на kolvrt.'
    elif fresh and timer.get('ActiveState') != 'active' and not current:
        state = 'offline'
    return {'state': state, 'fresh': fresh, 'observedAt': data.get('collectedAt'), 'current': current,
            'jobs': jobs, 'history': history, 'processes': processes, 'processesObservedAt': data.get('processesObservedAt'), 'fallbackHours': 2,
            'notice': notice, 'error': data.get('error') or (None if fresh or state == 'unconfigured' else 'Нет свежего снимка из продовой БД')}


def crawler_summary(data):
    """Expose the original presenter's latest report without recreating its history UI."""
    view, guest = data['view'], data.get('guest') or {}
    progress, latest = guest.get('progress') or {}, guest.get('latest')
    fresh = view.get('guestFresh', view['fresh'])
    current, last = None, None
    if latest:
        unfinished = not latest.get('finishedAt') or latest.get('status') == 'running'
        active = bool(fresh and view.get('live') and unfinished and latest.get('status') != 'interrupted'
                      and latest.get('id') and progress.get('runId') == latest['id'] and progress.get('activeSessions', 0) > 0)
        status = latest.get('status') or 'unknown'
        if unfinished and status != 'interrupted':
            status = 'running' if active else 'unfinished'
        executor = ' · '.join(value for value in (data.get('host'), (data.get('vm') or {}).get('name')) if value)
        last = {'id': latest.get('id'), 'job': latest.get('engine'), 'status': status,
                'started_at': latest.get('startedAt'), 'finished_at': latest.get('finishedAt'), 'executor': executor or None,
                'heartbeat_at': guest.get('observedAt') if active else None}
        if active:
            current = last
    return {'state': view['state'], 'fresh': fresh, 'observedAt': guest.get('observedAt') or data.get('collectedAt'),
            'summary': view['title'], 'current': current, 'lastRun': last}


def shared_header(config, active):
    links = []
    for item in [{'id': '', 'title': 'Все сервисы'}, *config]:
        current = ' class="nav-active" aria-current="page"' if item['id'] == active else ''
        links.append(f'<a href="/{escape(item["id"])}"{current}>{escape(item["title"])}</a>')
    return ('<header class="page-header"><a class="brand" href="/"><span class="brand-icon">к.</span>'
            '<span>kolvrt<small>Мониторинг сервисов</small></span></a><nav aria-label="Сервисы">'
            + ''.join(links) + '</nav><span id="clock" class="clock">Московское время</span></header>').encode()


class ExistingDashboard:
    """Mount the installed crawler UI and presenter without another web process."""
    def __init__(self, spec, config):
        self.root = Path(spec['dashboard'])
        self.snapshot = Path(spec['snapshot'])
        self.prefix = '/' + spec['id']
        self.spec, self.config = spec, config
        module_spec = importlib.util.spec_from_file_location('tver_dashboard', self.root / 'dashboard.py')
        self.module = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(self.module)

    def status(self):
        return self.module.presentation(self.module.read_snapshot(self.snapshot))

    def page(self, route):
        if route == self.prefix + '/api/status':
            return json.dumps(self.status(), ensure_ascii=False).encode(), 'application/json'
        files = {self.prefix: ('index.html', 'text/html'), self.prefix + '/app.js': ('app.js', 'text/javascript'),
                 self.prefix + '/style.css': ('style.css', 'text/css')}
        if route not in files:
            return None
        file, mime = files[route]
        body = (self.root / file).read_bytes()
        # Change mount URLs in the response only. Original files remain the source of truth.
        if file == 'index.html':
            body = body.replace(b'"/style.css"', b'"/assets/base.css"')
            body = body.replace(b'</head>', b'<link rel="stylesheet" href="/assets/style.css"></head>')
            body = body.replace(b'"/app.js"', f'"{self.prefix}/app.js"'.encode())
            def mount_header(match):
                nav = re.search('<nav aria-label="Разделы">.*?</nav>'.encode(), match.group())
                heading = ('<div class="hub-page-heading"><div><h1 class="hub-page-title">'
                           + escape(self.spec['title']) + '</h1><p>' + escape(self.spec['description']) + '</p></div>').encode()
                return shared_header(self.config, self.spec['id']) + heading + (nav.group() if nav else b'') + b'</div>'
            body = re.sub(b'<header class="page-header">.*?</header>', mount_header, body, count=1, flags=re.DOTALL)
        elif file == 'app.js':
            body = body.replace(b"'/api/status'", f"'{self.prefix}/api/status'".encode())
            body = body.replace(b"document.querySelectorAll('nav a')", 'document.querySelectorAll(\'nav[aria-label="Разделы"] a\')'.encode())
        return body, mime


def collect(config, dashboards=None):
    services = []
    for spec in config:
        base = {key: spec[key] for key in ('id', 'title', 'description')}
        try:
            if spec['adapter'] == 'tver':
                data = (dashboards or {})[spec['id']].status()
                base.update(crawler_summary(data))
            elif spec['adapter'] == 'wildrift':
                try:
                    data = load(spec['snapshot'])
                except (OSError, ValueError):
                    data = {}
                base.update(wildrift(data))
            else:
                raise ValueError('Unknown adapter')
        except (OSError, ValueError, KeyError, TypeError):
            base.update(state='unknown', fresh=False, history=[], jobs=[], error='Снимок состояния пока недоступен')
        services.append(base)
    return {'serverAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'services': services}


def handler(config, hosts):
    dashboards = {}
    for spec in config:
        if spec['adapter'] == 'tver':
            try:
                dashboards[spec['id']] = ExistingDashboard(spec, config)
            except (OSError, ImportError, ValueError, KeyError):
                pass  # The hub and other services remain available if this installation is missing.

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
                return self.respond(200, json.dumps(collect(config, dashboards), ensure_ascii=False).encode(), 'application/json; charset=utf-8')
            if route == '/health':
                return self.respond(200, b'ok', 'text/plain')
            if route == '/assets/base.css':
                try:
                    root = next(Path(spec['dashboard']) for spec in config if spec['adapter'] == 'tver')
                    return self.respond(200, (root / 'style.css').read_bytes(), 'text/css; charset=utf-8')
                except (OSError, StopIteration):
                    return self.respond(503, b'Shared stylesheet unavailable', 'text/plain')
            files = {'/assets/app.js': ('app.js', 'text/javascript'), '/assets/style.css': ('style.css', 'text/css')}
            for spec in config:
                prefix = '/' + spec['id']
                if spec['adapter'] == 'tver' and (route == prefix or route.startswith(prefix + '/')):
                    try:
                        mounted = dashboards[spec['id']].page(route)
                    except (OSError, KeyError, ValueError, TypeError):
                        return self.respond(503, b'Original dashboard unavailable', 'text/plain')
                    if mounted:
                        body, mime = mounted
                        return self.respond(200, body, mime + '; charset=utf-8')
                    return self.respond(404, b'Not found', 'text/plain')
            for page in ['/'] + ['/' + spec['id'] for spec in config if spec['adapter'] != 'tver']:
                files[page] = ('index.html', 'text/html')
            if route not in files:
                return self.respond(404, b'Not found', 'text/plain')
            file, mime = files[route]
            body = (HERE / file).read_bytes()
            if file == 'index.html':
                body = body.replace(b'<header data-shared-header></header>', shared_header(config, route.lstrip('/')))
            return self.respond(200, body, mime + '; charset=utf-8')

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

import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import build_opener, ProxyHandler, Request

spec = importlib.util.spec_from_file_location('monitor', Path(__file__).with_name('monitor.py'))
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


class MonitorTest(unittest.TestCase):
    def test_stale_snapshot_cannot_show_a_running_process(self):
        with patch.object(monitor, 'worker_process', return_value=[]):
            result = monitor.wildrift({'ok': True, 'collectedAt': '2020-01-01T00:00:00Z', 'history': [{'status': 'running', 'heartbeat_at': dt.datetime.now(dt.timezone.utc).isoformat()}]})
        self.assertEqual(result['state'], 'unknown')
        self.assertIsNone(result['current'])

    def test_fresh_process_and_stopped_timer_are_distinct(self):
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        with patch.object(monitor, 'worker_process', return_value=[{'Id': 'wildrift-scraper.timer', 'ActiveState': 'inactive'}]):
            self.assertEqual(monitor.wildrift({'ok': True, 'collectedAt': now})['state'], 'offline')
            self.assertEqual(monitor.wildrift({'ok': True, 'collectedAt': now, 'history': [{'status': 'running', 'heartbeat_at': now}]})['state'], 'running')

    def test_missing_source_does_not_break_other_services(self):
        result = monitor.collect([{'id': 'wildrift', 'title': 'Wild Rift', 'description': '', 'adapter': 'wildrift', 'snapshot': '/not-a-snapshot'}])
        self.assertEqual(result['services'][0]['state'], 'unknown')


class MountedDashboardTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        files = {'index.html': '<title>Existing UI</title><link href="/style.css"><script src="/app.js"></script><nav aria-label="Разделы">',
                 'app.js': "fetch('/api/status')", 'style.css': 'body { color: black; }',
                 'dashboard.py': 'import json\ndef read_snapshot(path): return json.loads(path.read_text())\ndef presentation(data): return {**data, "view": {"state": "warning", "fresh": True, "title": "Original state"}}',
                 'status.json': json.dumps({'guest': {'history': [{'id': 'original-run'}]}})}
        self.original = {name: text.encode('utf-8') for name, text in files.items()}
        for name, body in self.original.items():
            (self.root / name).write_bytes(body)
        config = [{'id': 'tver-journey', 'title': 'Crawler', 'description': '', 'adapter': 'tver',
                   'dashboard': str(self.root), 'snapshot': str(self.root / 'status.json')}]
        self.server = monitor.ThreadingHTTPServer(('127.0.0.1', 0), monitor.handler(config, {'127.0.0.1'}))
        self.addCleanup(self.server.server_close)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.thread.join, 2)
        self.addCleanup(self.server.shutdown)
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)
        self.client = build_opener(ProxyHandler({}))

    def get(self, path):
        with self.client.open(self.url + path, timeout=3) as response:
            return response.read()

    def test_original_page_assets_and_api_share_one_server(self):
        page = self.get('/tver-journey/').decode()
        self.assertIn('Existing UI', page)
        self.assertIn('href="/tver-journey/style.css"', page)
        self.assertIn('src="/tver-journey/app.js"', page)
        self.assertIn('href="/"', page)
        self.assertEqual(self.get('/tver-journey/app.js'), b"fetch('/tver-journey/api/status')")
        self.assertEqual(self.get('/tver-journey/style.css'), self.original['style.css'])
        status = json.loads(self.get('/tver-journey/api/status'))
        self.assertEqual(status['guest']['history'][0]['id'], 'original-run')
        self.assertEqual(status['view']['title'], 'Original state')
        summary = json.loads(self.get('/api/status'))['services'][0]
        self.assertEqual(summary['state'], status['view']['state'])
        for name, body in self.original.items():
            self.assertEqual((self.root / name).read_bytes(), body)

    def test_nested_routes_do_not_expose_source_or_accept_mutations(self):
        for path, method, expected in [('/tver-journey/dashboard.py', 'GET', 404),
                                        ('/tver-journey/../status.json', 'GET', 404),
                                        ('/tver-journey/api/status', 'POST', 405)]:
            with self.assertRaises(HTTPError) as error:
                self.client.open(Request(self.url + path, method=method), timeout=3)
            self.assertEqual(error.exception.code, expected)
            error.exception.close()
        with self.assertRaises(HTTPError) as error:
            self.client.open(Request(self.url + '/tver-journey/', headers={'Host': 'untrusted.example'}), timeout=3)
        self.assertEqual(error.exception.code, 403)
        error.exception.close()


if __name__ == '__main__':
    unittest.main()

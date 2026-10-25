import datetime as dt
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import build_opener, ProxyHandler, Request

spec = importlib.util.spec_from_file_location('monitor', Path(__file__).with_name('monitor.py'))
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)
observer_spec = importlib.util.spec_from_file_location('observer', Path(__file__).parents[1] / 'wildrift-worker' / 'observe.py')
observer = importlib.util.module_from_spec(observer_spec)
observer_spec.loader.exec_module(observer)


class MonitorTest(unittest.TestCase):
    units = [{'Id': 'wildrift-scraper.timer', 'LoadState': 'loaded', 'ActiveState': 'inactive'},
             {'Id': 'wildrift-scraper.service', 'LoadState': 'loaded', 'ActiveState': 'inactive'}]

    def test_assistant_idle_and_active_have_different_freshness_limits(self):
        ten_minutes = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=10)).isoformat()
        data = {'heartbeatAt': ten_minutes, 'state': 'idle'}
        self.assertTrue(monitor.assistant_status(data)['fresh'])
        active = monitor.assistant_status({**data, 'state': 'running', 'current': {'phase': 'generating'}})
        self.assertFalse(active['fresh'])
        self.assertEqual(active['state'], 'unknown')
        self.assertIsNone(active['current'])
        self.assertEqual(active['lastObservedAttempt']['phase'], 'generating')

    def test_assistant_stale_signal_preserves_real_last_success(self):
        previous = {'accepted': 894, 'finished_at': '2026-09-01T00:00:00Z'}
        result = monitor.assistant_status({'heartbeatAt': '2020-01-01T00:00:00Z', 'lastSuccessfulSync': previous})
        self.assertFalse(result['fresh'])
        self.assertEqual(result['lastSuccessfulSync'], previous)

    def test_assistant_source_independent_from_database_observer(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'assistant.json'
            file.write_text(json.dumps({'heartbeatAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'state': 'running', 'current': {'accepted': 0}}), encoding='utf-8')
            result = monitor.collect([{'id': 'wildrift', 'title': 'Wild Rift', 'description': '', 'adapter': 'wildrift', 'snapshot': '/missing', 'assistantSnapshot': str(file)}])
        self.assertFalse(result['services'][0]['fresh'])
        self.assertTrue(result['services'][0]['assistant']['fresh'])
        self.assertEqual(result['services'][0]['assistant']['current']['accepted'], 0)

    def test_stale_snapshot_cannot_show_a_running_process(self):
        with patch.object(monitor, 'worker_installed', return_value=True):
            result = monitor.wildrift({'ok': True, 'collectedAt': '2020-01-01T00:00:00Z', 'history': [{'status': 'running', 'heartbeat_at': dt.datetime.now(dt.timezone.utc).isoformat()}]})
        self.assertEqual(result['state'], 'unknown')
        self.assertIsNone(result['current'])
        self.assertEqual(result['observedAt'], '2020-01-01T00:00:00Z')

    def test_fresh_process_and_stopped_timer_are_distinct(self):
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        data = {'ok': True, 'collectedAt': now, 'processes': self.units, 'processesObservedAt': now}
        with patch.object(monitor, 'worker_installed', return_value=True):
            self.assertEqual(monitor.wildrift(data)['state'], 'offline')
            self.assertEqual(monitor.wildrift({**data, 'history': [{'status': 'running', 'heartbeat_at': now}]})['state'], 'running')

    def test_missing_source_does_not_break_other_services(self):
        with patch.object(monitor, 'worker_installed', return_value=True):
            result = monitor.collect([{'id': 'wildrift', 'title': 'Wild Rift', 'description': '', 'adapter': 'wildrift', 'snapshot': '/not-a-snapshot'}])
        self.assertEqual(result['services'][0]['state'], 'unknown')

    def test_not_connected_requires_confirmed_missing_units(self):
        with patch.object(monitor, 'worker_installed', return_value=False):
            result = monitor.collect([{'id': 'wildrift', 'title': 'Wild Rift', 'description': '', 'adapter': 'wildrift', 'snapshot': '/not-a-snapshot'}])
        self.assertEqual(result['services'][0]['state'], 'unconfigured')
        self.assertIn('ещё не подключён', result['services'][0]['notice'])
        self.assertIsNone(result['services'][0]['error'])

    def test_stale_process_data_is_unknown_even_with_a_fresh_database_snapshot(self):
        with patch.object(monitor, 'worker_installed', return_value=True):
            result = monitor.wildrift({'ok': True, 'collectedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                                      'processes': self.units, 'processesObservedAt': '2020-01-01T00:00:00Z'})
        self.assertEqual(result['state'], 'unknown')
        self.assertEqual(result['processes'], [])
        self.assertIn('Нет свежего состояния служб', result['notice'])

    def test_partial_unit_information_does_not_claim_not_connected(self):
        with patch.object(monitor, 'worker_installed', return_value=None):
            self.assertEqual(monitor.wildrift({})['state'], 'unknown')

    def test_web_checks_only_unit_files_and_never_runs_a_process(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(monitor, 'UNIT_DIRECTORIES', (root,)), patch.object(subprocess, 'run', side_effect=AssertionError('Web must not execute commands')):
                self.assertFalse(monitor.worker_installed())
                self.assertEqual(monitor.wildrift({})['state'], 'unconfigured')
                (root / 'wildrift-scraper.service').write_text('[Service]')
                self.assertTrue(monitor.worker_installed())
                self.assertEqual(monitor.wildrift({})['state'], 'unknown')


class ObserverTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'status.json'
        self.raw_path = Path(self.temp.name) / 'database-status.json'
        self.previous = {'ok': True, 'collectedAt': '2020-01-01T00:00:00Z', 'history': [{'id': 'old-run', 'status': 'success'}]}
        self.path.write_text(json.dumps(self.previous), encoding='utf-8')
        self.process_output = '\n\n'.join(f'Id={unit}\nLoadState=loaded\nActiveState=active' for unit in observer.UNITS)

    def test_success_publishes_processes_with_the_new_history(self):
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        def command(args, **kwargs):
            if args[0] == '/usr/bin/docker':
                self.raw_path.write_text(json.dumps({'ok': True, 'collectedAt': now, 'history': [{'id': 'new-run'}]}), encoding='utf-8')
                self.assertEqual(json.loads(self.path.read_text(encoding='utf-8')), self.previous)
                return subprocess.CompletedProcess(args, 0)
            return subprocess.CompletedProcess(args, 0, self.process_output, '')
        with patch.object(observer.subprocess, 'run', side_effect=command):
            self.assertTrue(observer.observe(self.path))
        data = json.loads(self.path.read_text(encoding='utf-8'))
        self.assertEqual(data['history'], [{'id': 'new-run'}])
        self.assertEqual(len(data['processes']), 2)
        self.assertIsNotNone(data['processesObservedAt'])
        self.assertEqual(list(self.path.parent.glob('.observe-*.tmp')), [])

    def test_successful_exit_without_a_new_raw_snapshot_does_not_refresh_history(self):
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        self.raw_path.write_text(json.dumps({'ok': True, 'collectedAt': now, 'history': [{'id': 'unused-raw'}]}), encoding='utf-8')
        with patch.object(observer.subprocess, 'run', side_effect=[subprocess.CompletedProcess([], 0), subprocess.CompletedProcess([], 0),
                                                                subprocess.CompletedProcess([], 0, self.process_output, '')]):
            self.assertFalse(observer.observe(self.path))
        data = json.loads(self.path.read_text(encoding='utf-8'))
        self.assertFalse(data['ok'])
        self.assertEqual(data['history'], self.previous['history'])
        self.assertEqual(data['collectedAt'], self.previous['collectedAt'])

    def test_new_raw_file_with_a_stale_database_timestamp_is_not_successful(self):
        def command(args, **kwargs):
            if args[0] == '/usr/bin/docker':
                self.raw_path.write_text(json.dumps(self.previous), encoding='utf-8')
                return subprocess.CompletedProcess(args, 0)
            return subprocess.CompletedProcess(args, 0, self.process_output, '')
        with patch.object(observer.subprocess, 'run', side_effect=command):
            self.assertFalse(observer.observe(self.path))
        self.assertFalse(json.loads(self.path.read_text(encoding='utf-8'))['ok'])

    def test_late_raw_write_after_timeout_cannot_replace_the_published_snapshot(self):
        calls = [subprocess.TimeoutExpired(['docker'], 18), subprocess.CompletedProcess([], 1),
                 subprocess.CompletedProcess([], 0, self.process_output, '')]
        with patch.object(observer.subprocess, 'run', side_effect=calls):
            self.assertFalse(observer.observe(self.path))
        published = self.path.read_bytes()
        self.raw_path.write_text(json.dumps({'ok': True, 'collectedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                                            'history': [{'id': 'late-container-run'}]}), encoding='utf-8')
        self.assertEqual(self.path.read_bytes(), published)
        self.assertFalse(json.loads(published)['ok'])
        self.assertEqual(len(json.loads(published)['processes']), 2)

    def test_docker_timeout_preserves_stale_history_without_exposing_stderr(self):
        secret = 'must-not-appear-in-public-status'
        calls = [subprocess.TimeoutExpired(['docker'], 18, stderr=secret), subprocess.CompletedProcess([], 0),
                 subprocess.CompletedProcess([], 0, self.process_output, '')]
        with patch.object(observer.subprocess, 'run', side_effect=calls):
            self.assertFalse(observer.observe(self.path))
        body = self.path.read_text(encoding='utf-8')
        data = json.loads(body)
        self.assertFalse(data['ok'])
        self.assertEqual(data['history'], self.previous['history'])
        self.assertEqual(data['collectedAt'], self.previous['collectedAt'])
        self.assertNotIn(secret, body)

    def test_dbus_failure_does_not_reuse_old_process_confirmation(self):
        with patch.object(observer.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'Failed to connect to bus')):
            self.assertEqual(observer.process_snapshot(), ([], None))


class CrawlerSummaryTest(unittest.TestCase):
    def snapshot(self, status='passed', fresh=True, live=True):
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        return {'host': 'kolvrt', 'vm': {'name': 'tver-journey'}, 'collectedAt': now,
                'view': {'state': 'idle' if fresh else 'unknown', 'title': 'Бот работает · ожидание', 'fresh': fresh, 'guestFresh': fresh, 'live': live},
                'guest': {'observedAt': now, 'latest': {'id': 'latest-run', 'engine': 'yandex', 'status': status,
                                                     'startedAt': '2026-10-25T09:00:00Z', 'finishedAt': None if status == 'running' else '2026-10-25T09:00:42Z'},
                          'progress': {'runId': 'latest-run', 'activeSessions': 1}}}

    def test_completed_latest_report_maps_type_result_and_time_without_claiming_current(self):
        result = monitor.crawler_summary(self.snapshot())
        self.assertIsNone(result['current'])
        self.assertEqual(result['lastRun']['job'], 'yandex')
        self.assertEqual(result['lastRun']['status'], 'passed')
        self.assertEqual(result['lastRun']['started_at'], '2026-10-25T09:00:00Z')
        self.assertEqual(result['lastRun']['executor'], 'kolvrt · tver-journey')

    def test_current_requires_live_matching_run_and_fresh_guest(self):
        snapshot = self.snapshot(status='running')
        result = monitor.crawler_summary(snapshot)
        self.assertEqual(result['current']['id'], 'latest-run')
        self.assertEqual(result['current']['heartbeat_at'], snapshot['guest']['observedAt'])
        snapshot['guest']['progress']['runId'] = 'another-run'
        result = monitor.crawler_summary(snapshot)
        self.assertIsNone(result['current'])
        self.assertEqual(result['lastRun']['status'], 'unfinished')
        self.assertIsNone(result['lastRun']['heartbeat_at'])
        stale = monitor.crawler_summary(self.snapshot(status='running', fresh=False))
        self.assertIsNone(stale['current'])
        self.assertFalse(stale['fresh'])
        self.assertEqual(stale['lastRun']['status'], 'unfinished')

    def test_saved_success_remains_historical_when_guest_is_stale(self):
        result = monitor.crawler_summary(self.snapshot(fresh=False, live=False))
        self.assertEqual(result['lastRun']['status'], 'passed')
        self.assertFalse(result['fresh'])
        self.assertIsNone(result['current'])


class MountedDashboardTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        files = {'index.html': '<head><title>Existing UI</title><link href="/style.css"><script src="/app.js"></script></head><main><header class="page-header"><nav aria-label="Разделы"><a href="#overview">Обзор</a><a href="#history">История</a><a href="#logs">Диагностика</a></nav></header><section id="original-content">Original content</section></main>',
                 'app.js': "fetch('/api/status');document.querySelectorAll('nav a')", 'style.css': 'body { color: black; }',
                 'dashboard.py': 'import json\ndef read_snapshot(path): return json.loads(path.read_text())\ndef presentation(data): return {**data, "view": {"state": "warning", "fresh": True, "title": "Original state"}}',
                 'status.json': json.dumps({'guest': {'history': [{'id': 'original-run'}]}})}
        self.original = {name: text.encode('utf-8') for name, text in files.items()}
        for name, body in self.original.items():
            (self.root / name).write_bytes(body)
        config = [{'id': 'tver-journey', 'title': 'Crawler', 'description': '', 'adapter': 'tver',
                   'dashboard': str(self.root), 'snapshot': str(self.root / 'status.json')},
                  {'id': 'wildrift', 'title': 'Wild Rift', 'description': '', 'adapter': 'wildrift', 'snapshot': str(self.root / 'missing.json')}]
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
        self.assertIn('href="/assets/base.css"', page)
        self.assertIn('href="/assets/style.css"', page)
        self.assertIn('src="/tver-journey/app.js"', page)
        self.assertIn('href="/"', page)
        self.assertEqual(self.get('/tver-journey/app.js').decode(), 'fetch(\'/tver-journey/api/status\');document.querySelectorAll(\'nav[aria-label="Разделы"] a\')')
        self.assertEqual(self.get('/tver-journey/style.css'), self.original['style.css'])
        self.assertEqual(self.get('/assets/base.css'), self.original['style.css'])
        status = json.loads(self.get('/tver-journey/api/status'))
        self.assertEqual(status['guest']['history'][0]['id'], 'original-run')
        self.assertEqual(status['view']['title'], 'Original state')
        summary = json.loads(self.get('/api/status'))['services'][0]
        self.assertEqual(summary['state'], status['view']['state'])
        for name, body in self.original.items():
            self.assertEqual((self.root / name).read_bytes(), body)

    def test_pages_share_header_styles_and_preserve_crawler_sections(self):
        for route, active in [('/', ''), ('/wildrift', 'wildrift'), ('/tver-journey', 'tver-journey')]:
            page = self.get(route).decode()
            self.assertIn('<header class="page-header">', page)
            self.assertIn('<span class="brand-icon">к.</span>', page)
            self.assertIn('href="/assets/base.css"', page)
            self.assertIn('href="/assets/style.css"', page)
            self.assertIn(f'href="/{active}" class="nav-active" aria-current="page"', page)
        original = self.get('/tver-journey').decode()
        self.assertIn('<nav aria-label="Разделы">', original)
        for section in ['overview', 'history', 'logs']:
            self.assertIn(f'href="#{section}"', original)
        self.assertIn('<section id="original-content">Original content</section>', original)

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

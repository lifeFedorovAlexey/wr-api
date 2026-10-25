import datetime as dt
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

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

    def test_tver_stale_control_is_not_live(self):
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        snapshot = {'collectedAt': now, 'collector': {'ok': True}, 'vm': {'running': True},
                    'guest': {'observedAt': now, 'controlReachable': False, 'service': {'ActiveState': 'active'}, 'progress': {'activeSessions': 1}}}
        result = monitor.tver(snapshot)
        self.assertEqual(result['state'], 'warning')
        self.assertIsNone(result['current'])

    def test_missing_source_does_not_break_other_services(self):
        result = monitor.collect([{'id': 'wildrift', 'title': 'Wild Rift', 'description': '', 'adapter': 'wildrift', 'snapshot': '/not-a-snapshot'}])
        self.assertEqual(result['services'][0]['state'], 'unknown')


if __name__ == '__main__':
    unittest.main()

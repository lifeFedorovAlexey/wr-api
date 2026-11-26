import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


updater = module('update')
observer = module('observe')
releaser = module('release')


class UpdateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for key, value in dict(ROOT=self.root, JOURNAL=self.root / 'journal.json',
                               BACKUP=self.root / 'backup.env', EXPORT=self.root / 'export',
                               STATE=self.root / 'status.json').items():
            scope = patch.object(updater, key, value)
            scope.start()
            self.addCleanup(scope.stop)
        self.original = 'WORKER_IMAGE=wildrift-worker:parser-132\nSCRAPE_REVISION=old\nUNCHANGED=value\n'
        (self.root / '.env').write_text(self.original)
        self.manifest = dict(schema='wildrift-worker-release', version=1, repository=updater.REPO,
                             api='a' * 40, data='b' * 40, imageId='sha256:' + 'c' * 64,
                             sha256='d' * 64, archive='worker-image.tar.gz', size=100, workflowRunId=1)
        self.manifest['tag'] = 'worker-v1-' + 'a' * 12 + '-' + 'b' * 12
        self.manifest['image'] = 'wildrift-worker:' + self.manifest['tag']
        self.release = dict(tag_name=self.manifest['tag'], author={'login': 'github-actions[bot]'})

    def test_manifest_rejects_unrelated_images_and_revisions(self):
        self.assertEqual(updater.validate_manifest(self.manifest, self.release), self.manifest)
        for field, value in [('api', 'main'), ('image', 'postgres:18'), ('archive', '../other'),
                             ('sha256', 'bad'), ('size', 2**32), ('workflowRunId', '1')]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                updater.validate_manifest({**self.manifest, field: value}, self.release)
        with self.assertRaises(ValueError):
            updater.validate_manifest(self.manifest, {**self.release, 'author': {'login': 'other'}})

    def test_config_preserves_every_unrelated_setting(self):
        result = updater.replace_config(self.original, self.manifest['image'], 'new')
        self.assertIn('UNCHANGED=value\n', result)
        self.assertIn('SCRAPE_REVISION=new\n', result)
        with self.assertRaises(ValueError):
            updater.replace_config(self.original + 'WORKER_IMAGE=other\n', 'new', 'new')

    def snapshot(self, root):
        root.mkdir(parents=True)
        file = root / 'data.json'
        file.write_text('{"ok":true}\n')
        entry = dict(file='data.json', size=file.stat().st_size, sha256=hashlib.sha256(file.read_bytes()).hexdigest())
        manifest = dict(schema='wildrift-public-snapshot', version=1, datasets={
            name: entry for name in ['champions:ru_ru', 'champions:en_us', 'patch:7.3g', 'trend-events:ahri:mid']})
        (root / 'manifest.json').write_text(json.dumps(manifest))
        return manifest

    def test_snapshot_hashes_and_path_boundaries_are_checked(self):
        root = self.root / 'snapshot'
        manifest = self.snapshot(root)
        self.assertEqual(updater.validate_snapshot(root), 4)
        (root / 'data.json').write_text('corrupted')
        with self.assertRaises(ValueError):
            updater.validate_snapshot(root)
        manifest['datasets']['patch:7.3g']['file'] = '../outside.json'
        (root / 'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):
            updater.validate_snapshot(root)

    def test_zero_exit_without_fresh_status_is_a_failure(self):
        with patch.object(updater, 'run', return_value=''), self.assertRaises(RuntimeError):
            updater.database_smoke({})

    def test_crash_recovery_rolls_back_configuration_and_restores_exact_timers(self):
        updater.BACKUP.write_text(self.original)
        (self.root / '.env').write_text('changed')
        updater.JOURNAL.write_text(json.dumps(dict(committed=False, paused=[updater.TIMERS[0]])))
        with patch.object(updater, 'run', return_value='') as command:
            updater.recover()
        self.assertEqual((self.root / '.env').read_text(), self.original)
        command.assert_called_once_with(['systemctl', 'start', updater.TIMERS[0]])
        self.assertFalse(updater.JOURNAL.exists())

    def test_failed_canary_never_pins_image_and_restores_timers(self):
        with patch.object(updater, 'run', return_value='inactive\n'), \
                patch.object(updater, 'clean_canaries'), \
                patch.object(updater, 'database_smoke', side_effect=RuntimeError('unavailable')), \
                self.assertRaises(RuntimeError):
            updater.install(self.manifest)
        self.assertEqual((self.root / '.env').read_text(), self.original)
        self.assertFalse(updater.JOURNAL.exists())

    def test_publish_failure_rolls_back_pin_and_removes_only_new_canary(self):
        old = updater.EXPORT / 'releases' / 'previous'
        old.mkdir(parents=True)
        def command(args, env=None, timeout=60):
            if args[0] == 'systemctl':
                return 'inactive\n'
            if args[0] == 'docker':
                release_id = next(a.split('=', 1)[1] for a in args if a.startswith('--release='))
                self.snapshot(updater.EXPORT / 'releases' / release_id)
                return ''
            if args[0].endswith('publish-public-data.sh'):
                self.assertIn(self.manifest['image'], (self.root / '.env').read_text())
                raise RuntimeError('VPS temporarily offline')
            return ''
        with patch.object(updater, 'run', side_effect=command), patch.object(updater, 'clean_canaries'), \
                patch.object(updater, 'database_smoke'), self.assertRaises(RuntimeError):
            updater.install(self.manifest)
        self.assertEqual((self.root / '.env').read_text(), self.original)
        self.assertEqual(list((updater.EXPORT / 'releases').iterdir()), [old])

    def test_success_publishes_one_export_and_retains_new_pin(self):
        exports = []
        def command(args, env=None, timeout=60):
            if args[0] == 'systemctl':
                return 'inactive\n'
            if args[0] == 'docker':
                release_id = next(a.split('=', 1)[1] for a in args if a.startswith('--release='))
                self.snapshot(updater.EXPORT / 'releases' / release_id)
                exports.append(release_id)
            return ''
        with patch.object(updater, 'run', side_effect=command), patch.object(updater, 'clean_canaries'), \
                patch.object(updater, 'database_smoke'):
            updater.install(self.manifest)
        self.assertEqual(len(exports), 1)
        self.assertIn(self.manifest['image'], (self.root / '.env').read_text())
        self.assertFalse(updater.JOURNAL.exists())

    def test_pending_or_failed_build_is_not_installable(self):
        release = {**self.release, 'assets': [dict(name='worker-release.json', browser_download_url=
                   f"https://github.com/{updater.REPO}/releases/download/{self.manifest['tag']}/worker-release.json")],
                   'published_at': '2026-11-26T10:00:00Z', 'draft': False, 'prerelease': False}
        with patch.object(updater, 'fetch', side_effect=[[release], self.manifest,
                          dict(name='Worker Release', head_branch='main', head_sha='a' * 40, conclusion=None)]):
            self.assertIsNone(updater.latest_release())


class ObserverRecoveryTest(unittest.TestCase):
    def test_only_stopped_owned_monitor_is_removed(self):
        for status, project, expected in [('created', 'wildrift-worker', True),
                                           ('exited', 'wildrift-worker', True),
                                           ('running', 'wildrift-worker', False),
                                           ('created', 'another-project', False)]:
            container = dict(Config={'Labels': {'com.docker.compose.project': project,
                                               'com.docker.compose.service': 'observer'}},
                             State={'Status': status})
            responses = [subprocess.CompletedProcess([], 0, json.dumps([container])),
                         subprocess.CompletedProcess([], 0)]
            with self.subTest(status=status, project=project), \
                    patch.object(observer.subprocess, 'run', side_effect=responses) as command:
                self.assertEqual(observer.prepare_monitor(), expected)
                self.assertEqual(command.call_count, 2 if expected else 1)
                if expected:
                    self.assertEqual(command.call_args.args[0], ['/usr/bin/docker', 'rm', 'wildrift-monitor'])


class ReleaseGateTest(unittest.TestCase):
    def test_newest_pipeline_attempt_must_be_successful(self):
        runs = [dict(id=1, name='API Pipeline', head_branch='main', event='push', conclusion='success'),
                dict(id=2, name='API Pipeline', head_branch='main', event='workflow_dispatch', conclusion=None)]
        with patch.object(releaser, 'github', return_value={'workflow_runs': runs}):
            self.assertFalse(releaser.successful_pipeline(releaser.API, 'a' * 40, 'API Pipeline'))


if __name__ == '__main__':
    unittest.main()

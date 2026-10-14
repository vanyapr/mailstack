import importlib.util
import pathlib
import sqlite3
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('push_hostops', ROOT/'deploy/bin/hostops.py')
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)

class PushBackup(unittest.TestCase):
    def test_snapshot_contains_committed_queue_and_keys_without_a_live_journal(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            source = root/'source'
            source.mkdir()
            with sqlite3.connect(source/'push.sqlite') as live:
                live.execute('PRAGMA journal_mode=WAL')
                live.execute('CREATE TABLE state (value TEXT)')
                live.execute("INSERT INTO state VALUES ('synthetic-queue-and-vapid')")
                live.commit()
                host.snapshot_push(source,root/'snapshot')
                live.execute("INSERT INTO state VALUES ('after-backup')")
                live.commit()
            with sqlite3.connect(root/'snapshot/push.sqlite') as copy:
                self.assertEqual(copy.execute('SELECT value FROM state').fetchall(), [('synthetic-queue-and-vapid',)])
            self.assertEqual((root/'snapshot').stat().st_mode & 0o777, 0o700)
            self.assertEqual((root/'snapshot/push.sqlite').stat().st_mode & 0o777, 0o600)

    def test_absent_push_is_compatible_and_symlinks_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            host.snapshot_push(root/'absent',root/'snapshot')
            self.assertFalse((root/'snapshot').exists())
            (root/'outside').write_bytes(b'not-a-database')
            (root/'source').mkdir()
            (root/'source/push.sqlite').symlink_to(root/'outside')
            with self.assertRaises(ValueError):
                host.snapshot_push(root/'source',root/'snapshot')

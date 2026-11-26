# PostgreSQL on kolvrt

The canonical API connection is `/var/www/wr-api/shared/database.env` on the VPS.
It contains one root-owned, mode 0600 `DATABASE_URL` using `127.0.0.1:55432/wildrift`.
The existing `wildrift-api-db-tunnel.service` on kolvrt provides that reverse SSH
forward. PostgreSQL is never exposed on a public interface.

API deployment requires the canonical file, exports its value to PM2, and writes
it to the active release environment. It cannot use the retired Actions database
secret. Fallback importers and chat maintenance use the `production-db` action:
verified VPS SSH host key, an ephemeral loopback-only forward, credentials read
from the canonical file, and automatic SSH cleanup after the job. When kolvrt is
offline, these database jobs fail; the VPS public snapshot keeps serving readers.

## Reconciliation and cutover

Pause the `sync-all-data.yml`, `sync-patch-notes.yml`, and `chat-maintenance.yml`
GitHub workflows and wait for any already-running jobs to finish before running
the cutover. Do not allow an API deployment concurrently. Resume these workflows
only after the fixed Actions configuration is on the default branch.

Install the entire `ops/wildrift-worker` directory in a temporary directory on
kolvrt, then run `sudo python3 /path/to/cutover-database.py`. The script:

1. Backs up the current target locally and on VPS, and proves restoration in an
   isolated database. A failed backup or restore stops the cutover.
2. Restores the original migration dump as a baseline. Tables not owned by local
   statistics/guide/RiftGG workers must match that baseline. Unexpected local
   edits stop the operation. Checksums normalize the session timezone to UTC.
   On `patch_notes`, a failed fetch/parse retry may change fetch metadata and
   failure diagnostics only; the structured parsed payload and effective-date
   fields must match the baseline. Successful local edits stop the operation.
3. Pauses local timers and private API/chat processes. Next.js remains online.
   Dumps the final cloud database and restores a separate candidate database.
4. Keeps cloud-owned user, auth, quiz, chat, editorial, and patch data in the
   candidate. Imports local worker tables. Additional cloud statistics snapshots
   receive new IDs, with history references remapped. Cloud scrape history is
   merged by UUID. Archived patch source revisions are unioned by their version,
   locale and content hash; conflicting HTML for the same hash stops the merge.
   Local champion rows take precedence; missing cloud rows remain.
5. Verifies cloud-owned table checksums, local guide/RiftGG checksums and validated
   foreign keys. Retains the original target database under `wr_before_cutover_*`,
   renames the candidate to `wildrift`, updates both release env and PM2 env, and
   checks the API statistics date before saving PM2 state.
6. Proves backup/restore again, enables the production backup timer, resumes local
   timers and requests a fresh public export. The cloud DB remains running.

Failures before attempting the live API switch restore the original API and
original target database name. After the live API switch is attempted, new user
writes may exist on kolvrt: automatic rollback to an older copy is forbidden.
Keep both source and target copies and inspect the reported failure before any
manual rollback. No database is deleted by the cutover tool.

## Backups

`wildrift-postgres-backup.timer` runs daily at 03:10 Moscow time plus up to ten
minutes of jitter. `backup-postgres.py` verifies the complete custom dump, saves
it under `/srv/backups/wildrift`, and sends a SHA-256 verified copy through SSH to
`/var/backups/wildrift-postgres` on VPS. Both locations retain seven days of this
program's backups. Migration dumps are excluded from automatic pruning.

Run `sudo python3 /srv/services/wildrift-worker/backup-postgres.py --verify-restore`
to prove a restore into a separately named temporary DB. Secrets and database
contents are never printed. Dumps contain private data and remain root-only.

Before pausing the paid cloud DB, verify the running API environment, a successful
fallback against kolvrt, fresh snapshot publication, backup timer and a restored
backup. Only then retire the unused `DATABASE_URL` GitHub secret. Keep the cloud
DB paused and its final dump available during the observation period.

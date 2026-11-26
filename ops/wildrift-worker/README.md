# Worker releases on kolvrt

`Worker Release` builds the API and data repository at full commit SHAs. A
production release requires successful `API Pipeline` and `UI Pipeline` runs
for those exact main commits. API pipeline completion triggers a check; the
15-minute schedule also detects changes in the data repository. GitHub can delay
scheduled workflows. Dispatch with `publish=false` builds/audits a branch without
publishing an installable release.

The public GitHub release contains a compressed Docker image and a checksum
manifest, never production environment files. The pinned Node base and both npm
lockfiles determine dependencies. Both production dependency audits and native
module imports must pass. No container-registry credentials, new inbound ports,
self-hosted Actions runner or passwordless general sudo are needed.

The manifest records the saved image's configuration digest, which Docker 26
uses as its image ID. Containerd-backed builders can report an OCI index digest
instead; that builder-specific ID is not used. CI loads the actual compressed
archive into a temporary isolated Docker 26.1.4 daemon and runs native module
imports there before publishing. This uses the classic image store from the
26.1 family deployed on kolvrt (Debian's 26.1.5+dfsg1 build).

## One-time installation

On kolvrt, run `sudo bash ops/wildrift-worker/install.sh` from the checked-out,
reviewed source. Installation requires root because it creates a systemd unit
and operates Docker. Later application releases do not require a person to run
commands. `install.sh` is the permanent installer in this repository, not a
generated diagnostic package.

The installer preserves the deployed `.env`, `compose.yaml`, credentials, DB
volumes, backup service and VPS publisher. It installs only `update.py`, the
observer recovery fix (including its service unit), the noninteractive scraper
unit, and `wildrift-worker-update.service/.timer` under the
existing service directory and `/etc/systemd/system`.

## Update transaction

Every five minutes the root-owned updater checks releases published by
`github-actions[bot]`. It checks the manifest, exact source revisions, archive
checksum, Docker image ID/configuration/labels and the successful release
workflow run before using the image. It does not execute a downloaded script.

It pauses only timers that were active, waits for running imports/exports,
checks a fresh read-only DB status, and generates one complete canary export.
Every snapshot dataset checksum is checked. Only then does it atomically pin
`WORKER_IMAGE` and `SCRAPE_REVISION`, verify DB access again, and invoke the
existing atomic publisher to update the VPS. That same export is published;
there is no duplicate full export. Failed canaries restore the previous config
and timer states. The transaction journal also recovers an interrupted update.
An in-progress import can postpone installation by up to twenty minutes; if it
does not finish, the old image stays active and a later check retries.

`/srv/data/wildrift-worker/deployment-status.json` records the latest operation,
revision and public snapshot. Failures retry after thirty minutes. GitHub or
network outages leave the installed image and published VPS snapshot working.
Application data is not mirrored to GitHub; PostgreSQL remains on kolvrt and
media remains in the existing S3 service.

Use `systemctl status wildrift-worker-update.timer` and
`journalctl -u wildrift-worker-update.service` for operations. To pause updates:
`systemctl stop wildrift-worker-update.timer`. The previous environment is kept
in the root-only `.env.before-auto-update`. The updater keeps the two latest
images it installed and removes only its own older release tags, never using a
global Docker prune. Snapshot and database backup retention remain under their existing
services. Schema migrations and changes to host units still need a separately
reviewed maintenance change; this updater replaces the application image only.

The observer automatically removes only a stopped `wildrift-monitor` container
whose Compose project/service labels identify it as this worker's observer. It
does not replace an active or foreign container. Noninteractive Compose jobs use
`-T`, avoiding the earlier heredoc/TTY failure.

# Deployment guide

MailStack is installed by a local controller using Docker images and Ansible. It
does not discover or modify a target on its own.

## Before an installation

Provide an explicitly approved Linux target, its checked SSH host key, a domain and
DNS plan, a TLS plan, and external backup storage. Keep the installation
configuration outside Git in an owner-only regular file (`chmod 600`). It may
contain credentials and must never be copied into an issue, pull request, log,
or chat. The controller will not learn or replace an SSH host key for you.

The protected JSON needs `ssh_host`, `ssh_user`, `domain`, `hostname`,
`first_address`, `admin_password`, `first_password`, `restic_password`, and an
external `backup_repository`. Optional keys include `ssh_port`, `ssh_key`,
`known_hosts`, `certificate_mode`, `mode`, `mox_origin` (connect mode only),
`backup_schedule`, and `push_enabled` (default `false`). The first address must
belong to `domain`; `hostname` is the intended mail/web host. Use distinct,
random production passwords, never the fixture credentials printed by `dev`.
The validation rules are in `cli/mailstack.py` and are covered by infrastructure
tests. `--images /path/to/images-amd64.json` can select an already reviewed
image bundle; otherwise the controller builds one for the target architecture.

The production command is `./mailstack install --config /path/to/protected-install.json`.
Use `--check` to ask Ansible for a dry run, but do not mistake a dry run for a
backup or production acceptance. The commands `status`, `doctor`, `backup`,
`restore`, `update`, and `uninstall` also require the same protected `--config`;
restore and uninstall require additional exact confirmation.

Build or obtain verified image archives on the controller. The controller accepts
only image manifests with immutable image IDs and matching SHA-256 checksums.

After loading a verified archive, the installer resolves only its own OCI,
runtime-manifest and config digests. Containerd and classic Docker stores can expose
different IDs for the same archive; Compose and runtime receipts pin the actual
immutable ID accepted by the target. A foreign ID, corrupted metadata or different
architecture stops installation. Runtime facts remain separate from the input
Ansible variables, whose extra-var precedence is preserved.

## What the installer manages

For a managed Mox installation, Ansible creates only MailStack-owned directories,
Compose resources, the product's Nginx virtual-host configuration and supporting
health/backup configuration. It validates Nginx before activation and restores the
previous owned configuration if validation or reload fails.

Existing sites are detected before and after the operation; foreign configuration is
not adopted or edited. The web application is bound to host loopback and runs
without root privileges or access to the Docker socket. Mox retains the public mail
ports and its internal APIs are restricted to the server-side BFF.

Connect mode leaves an existing Mox data directory and configuration untouched. It
requires a separately verified compatible Mox API, a backup, and a planned web
rollback before it is selected. This mode does not authorize replacing an
existing foreign Nginx virtual host: the installer refuses resources it does not
own. Migrating an existing webmail endpoint needs a separate, operator-reviewed
route switch with the original route and web image retained for rollback. Never
run two Mox instances against one live store.

## TLS, backup and rollback

TLS certificates are issued or deliberately reused only after the hostname, DNS and
HTTP routing have been accepted. A failed certificate or Nginx validation must keep
the prior active configuration.

Backups combine a Mox-consistent staging operation with encrypted external storage.
Success requires a concrete snapshot and a readable-data check. Keep the prior
application image, Mox executable, Nginx configuration and known-good backup until
the new deployment is accepted. `verifydata` may change a backup copy; do not run
it on the live mail store. Make a fresh untouched rollback snapshot after a dry-run
verification. Restore always starts in a separate inactive directory; activating
recovered mail service is a separate, operator-approved operation.

Application rollback returns to the previously verified web image and owned
configuration. It never claims to roll back irreversible Mox data changes; those
require restore from a verified backup.

## Production acceptance

Before serving real mail, separately verify public TLS, inbound and outbound SMTP,
IMAPS, DNS, backup recovery, and coexistence with approved neighbouring sites. A
successful local or CI run is not evidence of a production deployment.

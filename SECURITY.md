# Security policy

This repository contains source code, not production keys or a hosted service. Do not publish credentials, account names, real messages, subscription endpoints, private configuration, server addresses or deployment logs that contain them. If you find a vulnerability, use GitHub's private vulnerability reporting for this repository when available. If it is unavailable, open a non-sensitive issue requesting a private contact channel; do not include exploit details or secrets in that issue.

MailStack is designed around a private Mox API, a same-origin Next.js gateway, separate mail/admin sessions, CSRF validation, strict HTTPS in production, bounded inputs, non-root read-only web containers and immutable image verification. Its optional Web Push directory is private state and is disabled by default. These controls rely on a correctly configured reverse proxy and host; read [deployment](docs/DEPLOYMENT.md) before installation.

There is no guarantee of a production-safe unattended migration from another mail stack. Operators must test backups and restore, DNS/TLS, SMTP/IMAPS, and rollback with their own approved target. Keep old backups and images until the new installation has been accepted. The maintainers cannot recover mail that was not backed up.

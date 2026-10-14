# Architecture and code map

## Data ownership

```
Browser ──HTTPS──> Nginx ──loopback──> Next.js BFF ──private API──> Mox
                                                    │
                                                    └── mail store, SMTP, IMAP
```

Mox is the source of truth for messages, folders, flags, drafts, accounts and delivery. `apps/web` renders the interface and translates authenticated browser actions into Mox calls. It does not mount Mox's mail store or keep a second message database. The browser never receives Mox API cookies or credentials. Mail and admin sessions are separate, HttpOnly and SameSite=Strict; mutating routes check Origin and a session-bound CSRF token. Sessions, including a bounded credential required for Mox's send endpoint, are process-memory only. Restarting the web process signs users out; run one web replica, not a stateless/serverless pool.

`apps/web/src/lib/mox/client.ts` contains the typed Mox RPC boundary. Imported API declarations live under `apps/web/src/lib/mox/upstream/` with their upstream license. `apps/web/src/lib/mox/mail.ts` maps Mox responses to the mail UI; `apps/web/src/features/mail/` owns the visible client state. `apps/web/src/app/api/` contains the server routes. Authentication and request validation are in `apps/web/src/lib/auth/` and `apps/web/src/lib/security/`.

## Mox build and deployment

`scripts/prepare_mox_source.py` downloads a specific Mox source tag and verifies a pinned SHA-256 before building. `docker/mox/` and `docker/mox-nextjs/` contain reviewed source patches; generated image archives and runtime configuration are never tracked. `scripts/build_nextjs_images.py` builds immutable `linux/amd64` or `linux/arm64` images and records IDs plus archive hashes. The controller in `cli/mailstack.py` validates protected configuration, checksums and SSH identity before invoking Ansible under `deploy/`.

The managed profile runs Mox with host networking so SMTP/IMAP see the real client address. The web container is a non-root, read-only process bound to loopback, without a Docker socket. `connect` mode runs only the web service and leaves the existing Mox installation under its operator's ownership. The two modes are not interchangeable during an update.

## Optional Push state

Web Push is disabled unless `MAILSTACK_PUSH_ENABLED=1` and a private writable directory is configured. When enabled, `apps/web/src/lib/push/` keeps VAPID keys, subscriptions, hook credentials and an at-least-once queue in a separate SQLite file. It stores no message subject or body in notifications. Back up this private directory together with the matching Mox webhook configuration. See [Web Push operations](WEB-PUSH.md).

## Invariants for contributors

- Never make the browser call Mox's private API directly or place mail, passwords or tokens in client logs, URLs, fixtures or Git.
- Preserve the exact-target and ownership checks around Nginx, Docker images and backups. A passing local test does not authorize a production migration.
- Do not treat a send timeout as proof of failure: the message may have been accepted. Show an ambiguous result and check Sent before retrying.
- Keep tests synthetic. Tests may create disposable accounts on the local Mox fixture, but must not use real mailboxes or external delivery.
- Keep the bundled third-party notices when changing runtime dependencies or copied upstream declarations.

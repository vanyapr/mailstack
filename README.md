# MailStack

[Русская версия](README.ru.md) · [Architecture](docs/ARCHITECTURE.md) · [Deployment](docs/DEPLOYMENT.md) · [Contributing](CONTRIBUTING.md)

MailStack is a self-hosted webmail and administration interface for [Mox](https://www.xmox.nl/). Mox remains the authoritative mail server and store; the Next.js application is a server-side gateway and user interface. MailStack does not run a second message database or expose Mox's private APIs directly to the browser.

This is source code for operators and contributors, not a hosted mail service or a one-command production mail migration. A production installation needs a domain, DNS, TLS, a checked Linux target, external backups, and an operator who can verify mail delivery and recovery. Do not run the installer against an existing mail server without reading the [deployment boundaries](docs/DEPLOYMENT.md).

## What is included

| Directory | Purpose |
| --- | --- |
| `apps/web` | Next.js mail and admin UI, server-side Mox gateway, Web Push and tests |
| `docker/mox-nextjs` and `docker/mox` | Pinned Mox build and reviewed source patches |
| `cli`, `mailstack`, `deploy` | Controller, Docker Compose, Ansible, health and backup helpers |
| `scripts`, `tests/nextjs` | Reproducible image builds and infrastructure regression tests |

The browser supports folders, search, reading, composing, MIME drafts, attachments, account settings, mobile selection, and optional Web Push. The admin interface supports account/domain operations and diagnostics. Consult [the architecture guide](docs/ARCHITECTURE.md) for the data flow and trust boundaries.

## Local trial with synthetic mail

Requirements: Python 3.12+, a running Docker Engine/Desktop with Compose v2 and BuildKit, and enough disk space for the pinned Mox and Node images. The development stack binds port `3100` on loopback; stop another listener on that port first.

```sh
git clone https://github.com/vanyapr/mailstack.git
cd mailstack
./mailstack dev
```

The command downloads a checksum-pinned Mox source archive, builds the images, starts an isolated Docker Compose stack, and seeds synthetic local accounts and mail. It does not configure public DNS or send mail externally. It prints the local test credentials after startup. Never reuse them in production. See [development and testing](docs/DEVELOPMENT.md) before changing the code.

## Production outline

1. Review the [deployment guide](docs/DEPLOYMENT.md) and choose `managed` or `connect` mode. `connect` does not take ownership of an existing Mox installation.
2. Prepare a verified target, DNS/TLS plan, external backup repository and rollback plan. Keep credentials and host-specific configuration outside this repository in an owner-only file.
3. Build and verify immutable Linux image archives, or let the controller build them. Run `./mailstack install --config /path/to/protected-install.json` only for the approved target.
4. Verify HTTPS, SMTP/IMAPS, backup recovery, neighbouring services and real mail flows with a dedicated test account before treating the installation as operational.

No production secrets, server identities or mail data belong in Git. Web Push is off by default; [enable it deliberately](docs/WEB-PUSH.md) only after its persistent private storage and callback route have been reviewed.

## Verification

```sh
npm ci --prefix apps/web
npm run typecheck --prefix apps/web
npm test --prefix apps/web
npm run build --prefix apps/web
python3 -m unittest discover -s tests/nextjs -p 'test_*.py' -v
```

CI additionally builds the pinned Mox source, runs a local Mox integration stack and executes browser tests in Chromium and WebKit. CI is not a substitute for DNS, TLS, delivery or restore acceptance on your server.

## Licensing and security

MailStack's own code is [MIT licensed](LICENSE). Mox and bundled dependencies keep their respective licenses; see the [third-party license inventory](docs/THIRD-PARTY.md) and bundled [web runtime notices](apps/web/public/THIRD-PARTY-NOTICES.txt). See [security guidance](SECURITY.md) before reporting a vulnerability or publishing deployment logs.

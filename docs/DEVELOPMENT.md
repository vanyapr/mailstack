# Development and testing

The local stack is disposable and deliberately separate from production. Install Python 3.12+, Docker Engine/Desktop with Compose v2 and BuildKit, and Node.js 24 with npm. The checked-in package lock and Docker digests pin the application build; the Mox source download has a separately checked SHA-256.

Run `./mailstack dev` from the repository root. It builds the Linux images, starts local Compose and seeds synthetic accounts; port `127.0.0.1:3100` must be free. The command prints only demo credentials. `artifacts/`, `deploy/private/`, `apps/web/.next/` and `apps/web/node_modules/` are ignored by Git. Do not put a real installation configuration or mail archive under another tracked path.

For a code-only check:

```sh
npm ci --prefix apps/web
npm run typecheck --prefix apps/web
npm test --prefix apps/web
npm run build --prefix apps/web
python3 -m unittest discover -s tests/nextjs -p 'test_*.py' -v
```

For browser tests, start the local stack and run `npm run test:e2e --prefix apps/web`. The test runner uses synthetic accounts and fixtures. CI executes the application, infrastructure, pinned Mox source and local Mox acceptance jobs on Linux. The acceptance job installs Chromium and WebKit. An individual UI change should include a narrow regression test in `apps/web/tests/e2e/`; an API or security change should include unit/integration coverage.

To inspect a build artifact, run `python3 scripts/build_nextjs_images.py --platform linux/amd64 --export` (or `linux/arm64`). Compare the `images-<arch>.json` IDs and SHA-256 values with the corresponding archives before transfer. Do not use floating tags as deployment identity.

The code has no live production test mode. Use a separate approved target and dedicated synthetic test account for DNS, TLS, incoming/outgoing delivery, backup restore and mobile-browser acceptance. Keep those observations outside this public repository.

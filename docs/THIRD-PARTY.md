# Third-party components and licenses

MailStack's own source is MIT licensed. The product builds against a checksum-pinned [Mox v0.0.17 source archive](https://github.com/mjl-/mox/releases/tag/v0.0.17), with MailStack patches in `docker/mox/` and `docker/mox-nextjs/`. Mox publishes both [MIT](https://github.com/mjl-/mox/blob/v0.0.17/LICENSE.MIT) and [MPL-2.0](https://github.com/mjl-/mox/blob/v0.0.17/LICENSE.MPLv2.0) license files. The imported API declarations keep their upstream [MIT notice](../apps/web/src/lib/mox/upstream/LICENSE.MIT).

The direct web runtime dependencies and their installed package metadata at the time of this source snapshot are:

| Package | Pinned version | Declared license |
| --- | --- | --- |
| Next.js | 16.4.0 | MIT |
| React / React DOM | 19.3.0 | MIT |
| DOMPurify | 3.4.17 | MPL-2.0 or Apache-2.0 |
| Squire RTE | 2.4.9 | MIT |
| Hugeicons core free icons / React | 4.3.5 / 1.1.10 | MIT |
| Golos Text via Fontsource | 5.3.0 | OFL-1.1 |
| web-push | 3.6.7 | MPL-2.0 |

The exact dependency graph and integrity hashes are locked in `apps/web/package-lock.json`. Full notices for the bundled web runtime, including transitive packages, ship in [`apps/web/public/THIRD-PARTY-NOTICES.txt`](../apps/web/public/THIRD-PARTY-NOTICES.txt). The Mox build obtains its own pinned Go modules under their respective licenses. When updating any dependency or base image, review the new package's metadata, notices and security advisories before releasing a new image; this table is not a blanket relicensing of third-party code.

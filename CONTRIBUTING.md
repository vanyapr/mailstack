# Contributing

Issues and pull requests are welcome. Keep each change focused and explain the affected trust boundary (browser, BFF, Mox, installer or backup). Include a regression test and the commands you ran. For UI work, check a narrow mobile viewport and a desktop viewport; for mail operations, test against synthetic messages only.

Before opening a pull request, run the commands in [development and testing](docs/DEVELOPMENT.md), review `git diff --check`, and ensure no host identity, address list, credential, mail content, private configuration, archive or generated artifact is included. CI verifies the pinned Mox source and local mail flows on Linux. A green CI run does not imply that an arbitrary production server is safe to modify.

The source is MIT licensed. By contributing you agree that your contribution can be distributed under that license. Preserve notices for imported Mox declarations and third-party runtime packages. If a change updates a dependency, update its pinned lockfile and review its license and security advisories. See [security reporting](SECURITY.md) for vulnerabilities; never disclose a working exploit or real secrets in a public issue.

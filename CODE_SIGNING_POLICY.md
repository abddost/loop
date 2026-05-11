# Code Signing Policy

Free Windows code signing for Loop is provided by [SignPath.io](https://about.signpath.io/), certificate by the [SignPath Foundation](https://signpath.org/).

macOS builds are signed and notarized separately under an Apple Developer ID.

## Project roles

| Role | Who |
|---|---|
| Lead maintainer | Doston Yuldoshev ([@abddost](https://github.com/abddost)) |
| Reviewers | Doston Yuldoshev ([@abddost](https://github.com/abddost)) |
| Signing approvers | Doston Yuldoshev ([@abddost](https://github.com/abddost)) |

Loop is in early alpha and is not currently accepting external code contributions
(see [CONTRIBUTING.md](./CONTRIBUTING.md)). All commits, releases, and signing
approvals go through the lead maintainer.

## Privacy policy

Loop is a local desktop application. It does not collect analytics, telemetry, or
usage data, and it does not transmit any information to networked systems except:

- requests you explicitly make to the model providers you configure (Anthropic,
  OpenAI, Google, Cursor, etc.) using your own credentials;
- update checks against this project's GitHub Releases page.

No personal data is collected by the Loop project or its maintainers.

## Reporting

Security issues: see the "Report security issues privately" section of
[CONTRIBUTING.md](./CONTRIBUTING.md). For anything else, open an issue at
<https://github.com/abddost/loop/issues>.

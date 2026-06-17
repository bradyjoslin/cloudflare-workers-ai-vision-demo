# Security Policy

## Supported Versions

This is a personal demo/starter project, not an official Cloudflare product. Security fixes are provided on a best-effort basis for the current `main` branch.

| Version | Supported |
| --- | --- |
| `main` | Yes, best effort |
| Older forks / snapshots | No |

## Reporting a Vulnerability

Please report suspected vulnerabilities privately by contacting `security@example.com`. Replace this placeholder with your preferred security contact before publishing the repository publicly.

If you cannot use email, open a GitHub issue that says you need to report a security issue, but do **not** include exploit details, credentials, tokens, or private data in the public issue.

## Response Timeline

We will acknowledge receipt within 48 hours and aim to provide a fix within 7 days for critical issues.

## Disclosure Policy

Please allow time for a fix before publicly disclosing a vulnerability. Coordinated disclosure helps keep demo users safe while preserving transparency.

## Scope

In scope:

- Application code in this repository
- Documentation that could lead users to insecure configuration
- Example Cloudflare Workers configuration in `wrangler.jsonc`

Out of scope:

- Cloudflare platform vulnerabilities, which should be reported through Cloudflare's official security channels
- Browser or device-camera implementation issues
- Issues caused by users adding their own secrets, account IDs, or production-specific infrastructure

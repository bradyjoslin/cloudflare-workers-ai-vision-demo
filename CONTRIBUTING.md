# Contributing

Thanks for your interest in improving the Cloudflare Workers AI Vision Demo! This is a reference/starter project, so contributions that make it clearer, more correct, or easier to learn from are especially welcome.

## How to contribute

1. **Fork** the repository and create a branch from `main`:
   ```bash
   git checkout -b feature/short-description
   ```
2. Make your change (see [Development setup](#development-setup) below).
3. Make sure the project still builds: `npm run build`.
4. Commit with a clear message and open a **pull request** against `main`.

For anything beyond a small fix, please open an issue first to discuss the approach.

## Development setup

```bash
git clone https://github.com/<your-username>/cloudflare-workers-ai-vision-demo.git
cd cloudflare-workers-ai-vision-demo
npm install
npx wrangler login          # required: Workers AI runs remotely, even in dev
npm run dev                 # http://localhost:4321
```

- You need a Cloudflare account. The `AI` binding uses `"remote": true`, so **local development calls the real (billed) Workers AI service.** See the README's "Getting started" notes.
- If your login has multiple accounts, prefix commands with `CLOUDFLARE_ACCOUNT_ID=<id>`.
- The camera requires a secure context, so test on `localhost` (allowed) or a deployed `workers.dev` URL.

Useful scripts:

| Command | Description |
| --- | --- |
| `npm run dev` | Start the local dev server |
| `npm run build` | Type-check (`wrangler types`) and build for production |
| `npm run preview` | Build and preview the Worker locally |
| `npm run deploy` | Build and deploy to Cloudflare |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` |

## Code style

- This project uses **TypeScript** with Astro's `strict` config. Keep `npm run build` clean (it type-checks).
- There is no enforced linter/formatter; please **match the existing style** — tabs for indentation, single quotes in TS/JS, and the small, dependency-free approach used throughout.
- The client demos are intentionally written as self-contained inline `<script>` IIFEs with no bundler wiring. Keep new client code in the same spirit unless there's a strong reason not to.
- Prefer clear comments that explain **why**, not **what**.

## Commit messages

Write concise, imperative-mood subject lines (e.g. "Add baseball-cap target to PPE view"). [Conventional Commits](https://www.conventionalcommits.org/) are welcome but not required.

## Pull request process

- Keep PRs focused; one logical change per PR.
- Describe what you changed and how you tested it (the live views are hard to unit-test, so note the manual steps you ran).
- Ensure `npm run build` passes.
- Update the README or code comments if your change affects behavior or setup.

## Reporting bugs

Open a [bug report](.github/ISSUE_TEMPLATE/bug_report.md) and include steps to reproduce, your environment (OS/browser), and what you expected.

## Requesting features

Open a [feature request](.github/ISSUE_TEMPLATE/feature_request.md) describing the problem you're trying to solve.

## Code of conduct

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

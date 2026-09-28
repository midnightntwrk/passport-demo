# Agent skills

Skills that teach an AI coding agent (Claude Code, Cursor, Codex, Copilot, or
anything that reads the [Agent Skills](https://agentskills.io/) format) to
build on Midnight Passport without inventing an API.

| Skill | Use it when |
| --- | --- |
| [`midnight-passport/`](midnight-passport/) | adding "Continue with Passport" to an app, asking Passport to pay, verifying a signed redirect reply, gifting an item to a Passport by `.night` name or account from a backend, or building on stagenet with Passport |

## Install

With the [skills CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add midnightntwrk/passport-demo --skill midnight-passport
```

It asks which agents to install for; add `-g` for every project, or
`-a claude-code` (for example) to choose one. `npx skills add
midnightntwrk/passport-demo --list` shows what the repository offers.

By hand: copy `skills/midnight-passport` into `.claude/skills/` (Claude Code),
`.cursor/skills/` (Cursor), or wherever your agent reads skills.

## What is in it

- `SKILL.md`: what an app can ask Passport for, which Passports answer which
  channel on the release it was checked against, the workflow, and the rules.
- `references/`: the connect package API, transactions, errors,
  troubleshooting, React and Next.js, the redirect channel, the partner API,
  stagenet, listing, and copy.
- `scripts/vendor-connect.sh`: builds `@midnight-passport/connect` from a
  tagged release into a tarball, because the package is not on npm.
- `assets/connect-example/`: a minimal Vite + TypeScript "Continue with
  Passport" app with a Vitest suite.

## Keeping it true

The skill states what the code does at the release named in its front matter
(`checked-against`). When `packages/connect`, the consent surfaces in
`examples/passport-demo`, or `docs/demo/partner-api.md` change, update the
matching reference in the same pull request, and bump `checked-against` and the
default ref in `scripts/vendor-connect.sh` at the next release. A skill that
drifts from the code teaches an agent to write bugs with confidence.

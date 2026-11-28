# STATE (handoff)

## Current task
S3 approval-gated push: code, tests and docs written. Next: commit, push, dev deploy, healthz.

## Done this session
- (f) steer test: tests/steer.test.ts, pushed 5e38fe2.
- (c) per-file upload limit removed (7fe36d6), live check 20 MB on dev OK.
- S3 (uncommitted at time of writing): runner bundle route, GitPushService, git_push tool with approval card, WS push-decide, tests 244 pass, typecheck clean.

## Exact next step
1. `git add -A && git commit -m "S3: approval-gated git push..."` (after `npm run typecheck && npm test`).
2. Push with askpass recipe (AGENTS.md), delete the script, record the range in NOTES.
3. `docker compose up -d --build`, `curl -s http://127.0.0.1:8787/healthz` -> ok.
4. S4: deploy dev, then prod only after asking (user m00992 b: leave prod alone).

## How to run and test
- `npm run typecheck && npm test` (244 tests, about 1 min).
- Single file: `node --import tsx --test tests/git-push.test.ts`.

## Known failures
- Earlier: model write then read of turn-test.txt reported ENOENT (not investigated).
- Test files in workspace and chat DB are not to be deleted without approval.

## Needs you
- Set GIT_REMOTE_URL (https://github.com/AngelGarzaDev/Pi-Durable-Harness.git) in .env and enter github_repo_token in Secrets before a push can work.
- Folder picker browser check on dev still open.

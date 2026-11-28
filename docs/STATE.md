# STATE (handoff)

## Current task
S3 done and pushed (04c8028). Dev redeployed, healthz ok. Next: S4 (dev is current; prod only after asking).

## Done this session
- (f) steer test: tests/steer.test.ts, pushed 5e38fe2.
- (c) per-file upload limit removed (7fe36d6), live check 20 MB on dev OK.
- S3 committed 954c680, pushed 04c8028: runner bundle route, GitPushService, git_push tool with approval card, WS push-decide, tests 244 pass, typecheck clean.

## Exact next step
1. S4 check: a browser run of the approval card on dev (needs a model call; haiku only). Needs GIT_REMOTE_URL set first (user approval).
2. Prod deploy only after asking (user m00992 b: leave prod alone).

## How to run and test
- `npm run typecheck && npm test` (244 tests, about 1 min).
- Single file: `node --import tsx --test tests/git-push.test.ts`.

## Known failures
- Earlier: model write then read of turn-test.txt reported ENOENT (not investigated).
- Test files in workspace and chat DB are not to be deleted without approval.

## Needs you
- Set GIT_REMOTE_URL (https://github.com/AngelGarzaDev/Pi-Durable-Harness.git) in .env and enter github_repo_token in Secrets before a push can work.
- Folder picker browser check on dev still open.

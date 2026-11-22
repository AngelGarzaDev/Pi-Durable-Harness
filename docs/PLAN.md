# PLAN

## Goal 1: turn-limit notice (tests first)
- [x] 1.0 Add `npm test` (node:test) and a test script; keep typecheck passing.
- [x] 1.1 Server: when a submission ends `unanswered` with reason `turn_limit`, send a message to the browser. Test with a mock.
- [x] 1.2 UI: show a notice in the transcript ("Stopped after N tool rounds. Raise Max tool rounds in settings to continue."). Test the render function.
- [x] 1.3 (cause found; prompt rule added, live verification pending in 1.4) Investigate the old ENOENT read error; record cause in NOTES.md.
- [x] 1.4 Live check with claude-haiku-5-5 at 100000 tokens, using docs/templates if large text is needed. Log in NOTES.md.

## Goal 2: steer timing
- [x] 2.1 Test: steer sent during a multi-step run is recorded and acknowledged (mock or haiku live check).
- [x] 2.2 UI tooltip and docs/NOTES.md: steer joins after the current tool step.

## Goal 3: review tasks (design in root PLAN.md "Plan: review tasks")
- [ ] 3.1 Per-chat review setting (off by default), stored in settings.json per chat or globally (decide, record in NOTES).
- [ ] 3.2 Reviewer task via onYield hook, same model default, one retry max. Mock tests.
- [ ] 3.3 Transcript entry for review result; live check with haiku at 100000 tokens.

Done rule: tests, `npm run typecheck && npm test`, docs, commit.

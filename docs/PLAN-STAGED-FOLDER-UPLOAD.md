# Plan: staged folder upload

Status: PLAN ONLY (user m00500 "Copy the folder to a tmp dir then move it to the destination when the upload is done. Let's plan that out."). Nothing implemented yet.

## Goal
A folder upload either lands complete in its destination or not at all. Today files are written straight into the destination, so a cancelled or failed upload leaves a partial folder that the model can see.

## Why a tmp dir must be inside /workspace
- The runner mounts only the `workspace` volume at `/workspace` (compose.yaml line 54). `/tmp` in the runner is a different filesystem, so `rename` would fail with EXDEV. A move within one filesystem is the only atomic option.
- So the staging dir is a hidden sibling inside the workspace, for example `/workspace/<folder>/.staging-<uploadId>/` or `/workspace/.staging/<uploadId>/`. Decide in step 1 (see questions).

## Design
1. **Start.** The browser asks the app for an upload id (`POST /upload/start?folder=…` or `chat=…`). The app returns `id`. Staging path = `<target>/.staging-<id>`.
2. **Files.** Each file goes to the existing `POST /upload` with `x-relative-path` as today, plus a new `x-staging-id` header. The app puts the file under the staging dir instead of the destination. Same rules: `wx`, safe names, 15 MB per file, path containment.
3. **Commit.** After the last file, the browser calls `POST /upload/commit` with the id. The app asks the runner (new route, bearer token) to `rename(staging/<top>, target/<top>)`.
   - If `target/<top>` exists, the commit picks `<top>-2`, `<top>-3`, … (same rule as file clashes, applied to the folder name). Never merge.
   - Runner rejects paths outside `/workspace`.
   - Returns the final path; the app returns it to the browser, which inserts it into the message.
4. **Cancel / failure.** Browser calls `POST /upload/cancel` (or the runner deletes on its own when the app says so). Runner `rm -rf` the staging dir. Cancel must also work after a reload, so it is idempotent.
5. **Crash cleanup.** If the tab closes mid-upload, the staging dir stays. The app sweeps `.staging-*` older than 24 h at startup and once a day. Record ids and start times in a small JSON file in DATA_DIR so the sweep is simple.
6. **Resume (optional, later).** With the staging dir kept, a retry with the same id can skip files already present with the same size, so no `-2` copies appear on retry. This is the "option 4" idea from earlier and can be its own step.

## Steps (one commit each, tests first)
1. **Decide the staging location** (answer the question below). Write `docs/NOTES.md` entry.
2. **Runner:** `POST /v1/commit` (`{from, to}`) and `POST /v1/discard` (`{path}`), both inside `/workspace`, both refuse to overwrite. Unit test with the fixture runner.
3. **App:** `POST /upload/start`, `/upload/commit`, `/upload/cancel`; `x-staging-id` on `/upload`. Tests: files invisible until commit; commit moves the whole folder; clash gives `-2`; cancel leaves nothing; bad id refused.
4. **Sweep:** startup and daily removal of stale staging dirs. Test with an aged fixture.
5. **UI:** folder upload calls start, uploads, then commit (or cancel on the Cancel button). Chat path and workspace message use the committed path. Progress text unchanged.
6. **Docs:** README upload section (folder upload is all-or-nothing; staging dirs are hidden), NOTES entry, STATE.
7. **Live check** on dev: upload a folder, cancel one, complete one, check `/workspace` with `ls -la`.

## Risks
- A model run can read `.staging-*` directories in `/workspace`. Low impact; a hidden name. Could also be skipped by the file browser if one exists.
- Rename across a bind mount or on some filesystems may fail. Test on the real volume in dev.
- Two tabs uploading to the same destination: the `-2` rule covers it at commit time.
- Total size of staged data counts against disk space until commit or sweep. The 2 GB cap still applies.
- Single-file uploads stay direct (no staging) unless you want them staged too.

## Questions for you
1. Staging inside the workspace as a hidden dot-dir (my recommendation), or a separate volume mounted only into the runner?
2. On a name clash at commit, rename the new folder to `<name>-2` (recommended), or refuse with an error?
3. Should single files also go through staging, or only folders?
4. Sweep age: 24 h OK?

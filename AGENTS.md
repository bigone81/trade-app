# EdgeDesk Development Rules

## General
- Work only inside this repository.
- Keep changes focused on the requested task.
- Do not make unrelated refactors.
- Do not change trading logic unless the task explicitly requires it.
- Preserve existing behavior unless a change is explicitly requested.

## Validation
Before committing:
- Review the complete git diff.
- Run the relevant tests.
- Run TypeScript/type checks where applicable.
- Run the build when the change can affect the build.
- Do not commit if validation fails.
- Report any validation failure instead of hiding or bypassing it.

## Git
When the requested task is complete and validation succeeds:
1. Check `git status` and the complete diff.
2. Commit only files related to the task.
3. Use a concise commit message describing the change.
4. Push the commit to `origin main`.

Do not force-push.
Do not rewrite existing Git history.

## Production deployment
After a successful push to `origin main`, deploy EdgeDesk by running from the repository root:

    .\deploy.ps1

`deploy.ps1` is the canonical production deployment command.
Do not replace its deployment logic with manual SSH commands.

The deployment updates the production repository and rebuilds both Docker services:
- app
- worker

After deployment, verify from the deploy output that:
- the deployment command completed successfully;
- `app` is running and healthy;
- `worker` is running.

If commit, push, SSH, Docker build, container startup, or health check fails:
- stop;
- do not attempt unrelated fixes;
- do not force deployment;
- report the exact failure to the user.

## Production safety
- Never delete or recreate production data volumes.
- Never run `docker system prune`.
- Never run `docker volume prune`.
- Never delete the SQLite database or `trade_data`.
- Never reset production data.
- Never modify production `.env` unless explicitly requested.
- Never use destructive Git commands on production except those already contained in `deploy.ps1`.
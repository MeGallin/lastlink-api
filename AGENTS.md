# LastLink API agent entry point

Read README.md first. Keep each increment small, tested and reviewable. Do not build the remaining application in response to a general "continue".

The canonical project memory remains in the separate planning workspace, at outputs/memory.md under the owner's TFL-journey visibilty folder. Ask for that workspace if unavailable. Do not create a second independent project memory or publish private planning evidence here.

## Standards

- Express setup belongs in src/app.ts; listening and process lifecycle belong in src/server.ts.
- Strict TypeScript; small functions and explicit configuration/input validation.
- Add modules only when used. Future decision logic must be independent of Express and provider network calls.
- Transport APIs are upstream authorities. A health response does not establish data availability or journey safety.
- Never commit credentials, local environment files or raw personal journey records.
- Run npm run check and the Postman collection for HTTP changes. Record actual results, not assumed passes.
- Work directly on `main` for ordinary small increments. A separate branch is optional
  for risky or isolated work, or when the Product Owner requests it; no force pushes.
- Mandatory independent reviewer gate BEFORE every commit and push: follow docs/code-review-workflow.md. Spawn a separate read-only code-review agent; the implementation agent cannot approve its own work. Fix blocking findings, rerun relevant checks and obtain re-review. No reviewer available means stop before commit/push.
- Update the canonical planning memory at each checkpoint.
- Current increment: provider-neutral journey-check contract documentation and the
  main-first delivery policy (docs/journey-check-contract.md). The proposed endpoint
  is not implemented; no live provider calls or new routes are authorised in this
  increment. Preserve the owner's VS Code server on port 3000.

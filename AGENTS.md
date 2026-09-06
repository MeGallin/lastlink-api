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
- Small feature branches and descriptive commits after this initial baseline; no force pushes.
- Update the canonical planning memory at each checkpoint.
- Current increment: two fictional demo routes (docs/demo-contract.md). Stop for review before adding routes or live integration. Docker for Render remains deferred by the owner's latest sequencing. No provider, database, AI or frontend work yet.

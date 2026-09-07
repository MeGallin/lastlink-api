# Mandatory independent code-review gate

Effective: 6 September 2026, at the Product Owner's request.
Applies to every future commit and push, including documentation, configuration,
dependencies, tests and fixes. Earlier commits were made before this requirement;
reviewing them now is retrospective, never a claim of prior approval.

## Latest reviewed checkpoint

On 7 September 2026, the provider-failure refinement was independently reviewed
before commit and push. The exact staged tree was
`07a7b46011bc2a4be8b53a1032fe9a268355b774`, based on
`141b3b8788b1005ff94333a95e42864c7cf5de8d`, covering the provider snapshot
type, evaluator failure aggregation, contract documentation and regression
tests. `/root/code_reviewer` returned PASS with no P0–P2 blockers and
independently verified formatting, lint, typecheck, 77 tests, build and staged
whitespace. The reviewed candidate was committed as
`4e90a076cebf801e0143f93fbd7d8b371cf14a46` and pushed to `main` only after the
approval. The remaining P3 is a compile-time negative regression test for a
non-null failure value.

## Branch policy

`main` is the normal development and integration branch for this owner/agent
project. Work directly on `main` for ordinary small increments. A separate branch
is optional for risky experiments, larger or isolated changes, or when the Product
Owner requests branch isolation. The independent review gate applies to the exact
candidate on whichever branch is used. No force-pushes are allowed; normal Git
reverts remain available if a reviewed change later proves unsuitable.

## Delivery sequence

1. Read AGENTS.md, README.md, the relevant contract and current planning baseline.
   State the bounded change and architectural responsibilities before editing.
2. Implement only that change. Keep the owner-controlled VS Code server under
   their control.
3. Run npm run check. For HTTP changes run relevant Postman collections against
   the current build; keep foundation regressions covered. Review dependency
   advisories when the dependency tree changes. Record what actually ran.
4. Freeze the candidate and ask a separate code-review agent to inspect it.
   Include all changed, staged and untracked candidate files and relevant callers,
   tests and contracts. The reviewer must inspect code, not just the author's
   summary. Do not commit or push while review is pending.
5. Fix every blocking finding within the authorised scope. If fixing it requires
   an architectural decision or scope expansion, stop and ask the owner.
6. Rerun affected checks, including the full check command before the gate closes.
   Ask the independent reviewer to verify the fixes and regressions. Repeat
   until the verdict is PASS, with no unresolved blockers.
7. Stage only the reviewed files. Record the base HEAD, reviewed paths and staged
   tree ID (git write-tree) in the external planning review record. The reviewer
   must confirm that the exact staged candidate matches its review. Staging is
   allowed before review; a Git commit is not.
8. Commit only that approved staged tree. Compare HEAD^{tree} with the approved
   tree ID. Any material edit after approval invalidates approval and requires
   review again. Do not add an unreviewed last-minute documentation edit.
9. Before push, verify the current branch (normally `main`), remote, outgoing
   commits and the matching review record. Every new outgoing commit must have
   passed this gate. If optional branch isolation was used, merge or fast-forward
   only the reviewed candidate into `main`, then verify the resulting `main` tree.
   Re-review if code, base, dependencies or scope changed; otherwise verify the
   existing approval rather than repeating an unchanged review. Do not push if
   uncertain.
10. Report commit, push verification, tests, review verdict and remaining limits.
    Pause for owner review before the next increment. Update canonical memory.

For documentation-only changes, formatting and consistency checks are sufficient
where explicitly justified by the reviewer; do not claim unrun tests passed.
The gate still applies. Reviews do not authorise commits, pushes or scope changes
that the user has otherwise excluded.

## Reviewer responsibilities

Use the separate agent prompt in review-agent.md. The reviewer is read-only and
does not author its own fixes, commit or push. The implementation agent fixes
findings, then submits the new candidate for review.

Review:

- Correctness, boundary conditions and truthful API contracts.
- Architectural boundaries, dependency direction and scope discipline.
- DRY: duplicated business rules and validation must not diverge; do not extract
  trivial repeated syntax solely to reduce line count.
- SOLID pragmatically: focused responsibilities, narrow useful interfaces,
  substitutable behaviour and separation of policy from infrastructure. Do not
  introduce classes, factories or speculative layers just to tick a principle.
- Security: untrusted input, secrets, dependency risk, safe errors, logs and data
  exposure. Consider operational failure paths, not only happy-path responses.
- Tests: input-driven outcomes, negative cases, regression protection and
  assertions that prove the contract. Passing tests are evidence, not approval.
- Maintainability: strict types, understandable names, focused modules and
  documentation that matches actual implementation.

## LastLink architectural constraints

- Node/Express/TypeScript backend; separate client repository, not a monorepo.
- Express setup separate from the listening process.
- Decision calculations must not depend on Express or fetch provider data.
- Transport APIs are upstream authorities. Synthetic data must be labelled and
  must not imply live verification, confidence or safe passenger advice.
- Future adapters/normalisation, evaluation and HTTP presentation have separate
  responsibilities; add boundaries when needed, not empty architectural layers.
- No silent architecture changes. Flag deviations and either fix them or obtain
  an explicit owner-approved decision before proceeding.
- Docker/Render is the agreed deployment direction. No provider, database, AI,
  frontend or deployment expansion without the relevant reviewed checkpoint.

The canonical project memory and TECH-02 baseline remain in the separate planning
workspace. Ask for them if needed; do not publish private evidence into this repo.

## Findings and verdict

Each finding identifies severity, file/line, violated contract/principle, concrete
failure or maintainability impact, proposed correction and verification needed.

- P0/P1: critical or high-impact correctness/security/architecture defects.
- P2: actionable correctness, architecture, maintainability or coverage problems.
- P3: optional improvement or cosmetic suggestion, with rationale.

Unresolved P0–P2 findings block commit and push. Track optional P3 suggestions
without disguising real architectural defects as preferences. Disputed findings
must be resolved with evidence and reviewer reassessment; the author cannot
unilaterally mark them passed. Escalate unresolved decisions to the owner.

Verdict is PASS or CHANGES_REQUIRED. Record untested areas and residual risk even
on PASS. Review is not a guarantee that all bugs or security issues were found.

Store review evidence in the external planning workspace: date, reviewer task,
scope/base, paths/tree ID, findings, fixes, executed checks, verdict and verified
commit/push. Do not copy a second independently maintained memory into this repo.

## Enforcement boundary

This is a mandatory instruction for agents working in this repository. If an
independent reviewer cannot run, stop before committing or pushing and explain
the blocker. Do not substitute self-review.

No Git hooks, CI reviewer or GitHub branch-protection rule has been installed by
this policy. Git itself does not technically prevent a manual bypass. Such
enforcement can be discussed as a separate increment; do not present a checkbox
or hook as proof that meaningful independent review occurred.

# Oshi Connect Constitution

These rules are binding for all agent work across the Oshi Connect ecosystem. They beat ad-hoc habit. A product `AGENTS.md` MAY be stricter. It MUST NOT be looser.

**Version:** 2.0.1 | **Ratified:** 2026-08-14 | **Last Amended:** 2026-10-02

2.0.0 redefines tests. It adds the UI kit, hosting, Cloudflare services, package manager, identity, schema release, UI check, and TypeScript rules. 2.0.1 copies those rules into each product repository so a Cloud Agent or a Grok Bot can read them without a sibling checkout.

Canonical file: `docs/constitution.md`. Keep the MUST list identical in `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/constitution.mdc`, and `.github/copilot-instructions.md`. Copy `.cursor/rules/constitution.mdc` and `.cursor/CLOUD.md` into each product repository with `./scripts/sync-constitution-rules.sh`.

## MUST list

1. **UI copy restraint.** Do not add helper text, labels, or empty states that only repeat what the control already shows. Prefer affordance over narration.
2. **Agent design smells.** Do not default to card grids, decorative gradients, or a colored side bar on the selected tab. Do not add pills or badges when nearby copy, labels, or state already convey the same information. Prefer layout, type, spacing, and one clear primary action.
3. **Object storage.** Default to Cloudflare R2. Put uploads behind a small S3-compatible adapter (`put` / `get` / `delete` / `presign`) so another S3 API provider can replace the implementation without rewriting callers.
4. **Email.** Send mail with Cloudflare Email Sending. Receive mail with Cloudflare Email Routing or Email Workers. Do not add a third-party ESP unless a product already depends on one and the task is not introducing mail.
5. **Tests.** Prefer an integration test or an end-to-end test for a critical path. Do not add a large unit-test suite for wiring, static copy, or behavior a browser check will catch. Add a unit test when the logic is pure and a higher-level test would be slow or unclear.
6. **Language.** Write long prose (PR text, specs, docs, explanations) in [ASD-STE100 Simplified Technical English](https://www.asd-europe.org/standards-specifications/simplified-technical-english/). Do not use this rule to add UI copy; UI stays short (principle 1).
7. **Database shape.** Do not add columns for a related group that is not a FK and is not usually filtered or indexed (for example image width/height or nested metadata). Store that group as JSONB (or the product JSON column type). Keep real relations and query keys as columns.
8. **Asset images.** When a high-traffic page serves an image from the Cloudflare asset CDN, deliver it through Cloudflare Image Transformations (`/cdn-cgi/image/`). Do not use the raw object URL as the page image source.
9. **UI kit.** Build Svelte UI with `@oshi-connect/ui` from `oshi-connect-ui`. Do not add a second primitive kit in a product when the shared kit already has the control.
10. **Hosting.** Deploy SvelteKit applications to Cloudflare. Deploy Elixir backends to Fly.io.
11. **Cloudflare services.** Prefer Cloudflare for DNS, Realtime, Turnstile, Email Sending, R2, and Image Transformations. Do not add another vendor for that job unless the product already depends on it.
12. **Package manager.** TypeScript and JavaScript projects use pnpm. Do not introduce npm or yarn as the project package manager.
13. **Identity.** New sign-in uses WorkOS AuthKit. Do not enable Zitadel or deploy `oshi-connect-auth`.
14. **Schema release.** When new code needs a new schema, apply the migration before you deploy that code. Name the migration file in the PR summary and in the test plan.
15. **UI check.** When you change UI, layout, routing, or rendered data, verify the changed flow in the browser before you finish.
16. **TypeScript.** Prefer functional TypeScript. Add a comment only when the logic is hard to follow without it.

## Principles

### I. UI copy restraint

The UI MUST show meaning through controls, layout, and state. Do not write extra text that only repeats what the user already sees.

- Do not add a heading, hint, or empty-state paragraph that restates the button label, field name, or visible result.
- Do not narrate the workflow in the page ("Click save to save your changes").
- Prefer a clear control over a sentence that explains the control.

**Rationale:** Extra copy adds noise. Users read the control. Agents often over-explain. Short UI is easier to scan and to translate.

### II. Agent design smells

Generated UI MUST NOT use decorative patterns as the default visual system.

- Do not wrap every section in a card.
- Do not use decorative gradients as the brand surface.
- Do not mark the selected tab with a colored side bar as the main navigation cue.
- Do not add pills or badges when nearby copy, labels, or state already convey the same information. Use a pill only when it is the unique, scannable signal (for example a status that is not already in the heading).
- Prefer hierarchy from type, spacing, and one clear primary action.

**Rationale:** Card grids, gradient washes, tab side highlights, and redundant pills are overused agent defaults. They hide structure and look generic.

### III. Object storage

New object storage MUST default to Cloudflare R2.

- Callers MUST talk to a small S3-compatible adapter with `put`, `get`, `delete`, and `presign`.
- Do not call the R2 SDK from feature code.
- You MAY swap the adapter to another S3 API provider without a rewrite of callers.

**Rationale:** R2 is the default in this ecosystem. An S3-shaped adapter keeps a later provider change local to one module.

### IV. Email

New outbound mail MUST use Cloudflare Email Sending. New inbound mail MUST use Cloudflare Email Routing or Email Workers.

- Do not add a third-party ESP as the default.
- If a product already sends mail through another provider, keep that path unless the task is to introduce or replace mail.

**Rationale:** One email path reduces ops cost and keeps secrets in the Cloudflare account we already operate.

### V. Tests

Prefer an integration test or an end-to-end test for a critical path.

- Cover a critical user path with an integration test or an end-to-end test (for example sign-in, checkout, publish, capture, or print).
- Do not add unit tests that only lock copy, labels, layout, or component wiring. A browser check is enough for those.
- Add a unit test for pure logic (pricing, permissions, state transitions) when that test is the smallest check that can fail.
- When an integration test needs a real database, HTTP service, or queue, state that reason.
- Do not add a broad suite for coverage with no target path.

**Rationale:** Critical paths fail at boundaries. A large unit-test suite for glue and copy does not catch those failures. A few higher-level tests on the real path do.

### VI. Language

Long prose MUST follow ASD-STE100 Simplified Technical English.

- Apply this to PR text, specs, plans, docs, and explanations to users.
- Use short sentences. Use approved word meanings. Do not write ornamental language.
- State the fact or the action. Do not add a contrast the reader did not ask for.
- Do not use this rule to add UI copy. UI copy stays short (Principle I).

**Rationale:** STE100 makes instructions clear for humans and for agents. UI copy has a different job: stay out of the way.

### VII. Database shape

Do not overload a schema with columns that belong together as a document.

- If a group of fields is semantically related, is not a foreign key, and is not usually filtered or indexed (for example image width and height, or nested metadata), store the group as JSONB (or the product JSON column type).
- Keep foreign keys, unique keys, and fields you filter or sort on as real columns.
- Do not split a metadata blob into many nullable columns "for completeness".

**Rationale:** Extra columns increase migration cost and hide grouping. JSONB keeps related attributes together until a query need appears.

### VIII. Asset images

When a high-traffic page shows an image from our Cloudflare asset CDN, you MUST use Cloudflare Image Transformations.

- Rewrite the public object URL to `/cdn-cgi/image/<options>/<path>` on the same asset host (today `assets.oshi-connect.net`).
- Set `width` to the display size (and `height` if you crop). Use `format=auto`. Prefer `fit=contain` unless the layout needs a crop.
- Do not use the raw R2 or public object URL as `src` on a landing page, feed, event list, or other high-traffic view.
- A low-traffic staff tool MAY use the original (for example a review screen that must show full resolution).
- Static files that are not on the asset CDN (for example `/images/logo.svg` in the app) are out of scope.

**Rationale:** Original uploads can be several megabytes. Transformations cut bytes, pick WebP or AVIF, and cache at the edge.

### IX. UI kit

Svelte UI MUST use `@oshi-connect/ui` from `oshi-connect-ui` when the kit has the control.

- Do not create a local button, input, dialog, or similar primitive that copies the shared kit.
- A product MAY add a control the kit does not have. Prefer moving a repeated control into the kit.
- Phoenix LiveView and other non-Svelte UI stay on their own stack. Match the visual system. Do not import the Svelte kit there.

**Rationale:** One kit keeps Svelte products consistent. A second kit drifts.

### X. Hosting

SvelteKit applications MUST deploy to Cloudflare. Elixir backends MUST deploy to Fly.io.

- Do not add a new host for a SvelteKit app or an Elixir backend when these two already fit.
- A product that already runs somewhere else MAY stay there until the task is to move it.

**Rationale:** Two hosts cover the two stacks we ship. Extra hosts add secrets and deploy paths.

### XI. Cloudflare services

Prefer a Cloudflare product when it covers the job.

- Use Cloudflare DNS, Cloudflare Realtime, and Cloudflare Turnstile for those jobs.
- Object storage, email, and image delivery follow Principles III, IV, and VIII.
- Do not add another vendor for the same job unless the product already depends on it.

**Rationale:** The Cloudflare account is the default edge. A second vendor needs a dependency the product already has.

### XII. Package manager

TypeScript and JavaScript projects MUST use pnpm.

- Do not add npm or yarn as the package manager for a new project or a new workspace.
- Use the lockfile and scripts the repo already has.

**Rationale:** One package manager keeps installs and CI the same across TypeScript products.

### XIII. Identity

New sign-in MUST use WorkOS AuthKit.

- Do not enable `ZITADEL_AUTH_ENABLED`.
- Do not deploy `oshi-connect-auth`.
- Do not add a second identity provider.

**Rationale:** WorkOS AuthKit is the identity provider as of 2026-09-25. Zitadel work is parked.

### XIV. Schema release

When new code needs a new schema, apply the migration before you deploy that code.

- Name the migration file in the PR summary and in the test plan.
- Put migrate before deploy in the release plan when the new code needs the new schema.

**Rationale:** Code that reads a missing column fails in production. The migration has to land first.

### XV. UI check

When you change UI, layout, routing, or rendered data, verify the changed flow in the browser before you finish.

- Exercise the path a user takes: click, type, submit, and navigate.
- A single screenshot is not that check.
- Check other pages that read the same state.
- If no browser is available, use the closest substitute and say what you could not verify.

**Rationale:** UI defects show up in the running flow. A render check misses them.

### XVI. TypeScript

Prefer functional TypeScript.

- Prefer functions and plain data. Do not add a class when a function is enough.
- Add a comment only when the logic is hard to follow without it.

**Rationale:** Functions and plain data are easier to test and to change. Comments that repeat the code go stale.

## Governance

- **Authority.** Principles I–XVI are gates. SPDD Norms and Safeguards MUST include them. A conflict with a MUST is a blocker. Resolve it by changing the spec, plan, or code. Do not weaken the principle. When two principles touch the same topic, follow the stricter one.
- **Amendments.** Change this file in a PR with rationale. Bump the version. Update the MUST list in `AGENTS.md`, `CLAUDE.md` (`cp AGENTS.md CLAUDE.md`), `.cursor/rules/constitution.mdc`, and `.github/copilot-instructions.md` in the same change. Run `./scripts/sync-constitution-rules.sh` and commit the copied `.cursor/rules/constitution.mdc` and `.cursor/CLOUD.md` in each product repository. A Cloud Agent or a Grok Bot clones one repository. It does not see a sibling checkout.
- **Versioning.** MAJOR = remove or redefine a principle. MINOR = add a principle or expand a MUST. PATCH = clarify wording with no change of meaning.
- **Compliance.** Every PR MUST follow these rules. Unjustified deviation blocks merge.

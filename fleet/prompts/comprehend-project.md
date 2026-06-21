# Deep project comprehension (READ-ONLY) — build the Project Brain

You are a senior engineer joining this project. Study the repository thoroughly and write a
durable understanding of it. Do NOT edit any code. This is a read-only comprehension pass — the
fleet will read your output before EVERY future task on this app, so future runs act as if they
have worked here for years. Be specific to THIS codebase; never generic.

App: {{APP_NAME}} (stage: {{STAGE}})
Stated north star: {{NORTH_STAR}}
Standing context: {{STANDING_CONTEXT}}

## Study (read widely before writing)
Read the README, package/manifest files, the main entry points, the directory structure, a
representative sample of source files, the test setup, CI config, and any docs or design files.
Infer what you can't find stated.

## Write the brain — EXACTLY these sections, in markdown, concrete and specific

## Product
What this app does, who uses it, and the single outcome that means it is production-ready
(refine the stated north star using what the code actually shows).

## Architecture
The real shape: entry points, the major modules/layers and how they relate, the data flow,
where state lives, and every external service/integration (DB, auth, payments, APIs, queues).
Name actual files and directories.

## Conventions (match these — never impose generic patterns)
The patterns THIS repo already uses: language/framework + version, naming style, how errors are
handled, the test framework and how tests are written, state management, styling/design system
(design tokens, component library), and any house rules you can infer from the code.

## Critical & risky paths
The flows where a bug costs money, data, or trust — auth, payments/billing, data writes/
migrations, anything irreversible. These get the highest care and the strongest tests.

## How to build, test, and run locally
The exact commands, the env vars/services needed, and how to seed a safe local test setup
(this informs `.fleet/setup.sh`). Note anything that needs real credentials (defer those).

## Known tech debt & gotchas
The sharp edges: fragile areas, partial implementations, TODO/FIXME clusters, things that look
wrong but are intentional, and traps a newcomer would fall into.

## Output
Return the brain as markdown starting with a `# Project Brain` heading, nothing else after it.

# Scheduling agent for property maintenance

Coordinates handyman visits between tenants and a single handyman over stdin/stdout until every work order is `scheduled` or `requires_review`.

> Status: planning and development harness (phase 0) complete; product implementation (phase 1) next. See [`docs/planning/`](docs/planning/README.md) for how the architecture and the development harness were chosen, and [`docs/adr/`](docs/adr/) for the decisions.

## Approach in one line

Code decides; the LLM interprets free text, and the code distrusts that interpretation at the edges.

## Build and run

```bash
docker build -t agent .
docker run --env-file .env -i \
  -v "$(pwd)/work_orders.csv:/app/work_orders.csv:ro" \
  -v "$(pwd)/traces:/app/traces" \
  agent
```

`.env` must contain `ANTHROPIC_API_KEY`. It is never committed.

## Repository layout

The repository holds two things: the product, and the development harness I built it with. Evaluating the product needs only Docker; the harness is there to show how it was built.

| Part | Paths | Purpose |
|---|---|---|
| **Product** | `src/`, `Dockerfile`, `package.json`, `tsconfig.json`, `traces/examples/` | The scheduling agent and a committed example trace. Only this goes into the image (see `.dockerignore`) |
| **Tests** | `tests/` | Unit and scenario tests, plus `tests/harness/` for the harness's own checks. Run with `pnpm check` |
| **Development harness** | `CLAUDE.md`, `.claude/` (rules, skills, hooks), `specs/` (product spec, invariants, feature specs), `scripts/` | The rules and checks the coding agent works inside. See [`docs/planning/03-harness-engineering.md`](docs/planning/03-harness-engineering.md) |
| **Decisions** | `docs/planning/`, `docs/adr/` | How the architecture was chosen, and the individual decisions |

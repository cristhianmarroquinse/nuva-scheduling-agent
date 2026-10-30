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

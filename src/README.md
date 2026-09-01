# Source layout and boundary rules

`src/server.js` is the composition root. It may assemble the runtime modules,
but feature modules must not import the composition root or one another through
back references.

Files may import siblings within the same runtime module. Imports across runtime
modules must follow the allowlist enforced by `scripts/check-boundaries.js`.

## Runtime modules

- `config/`: environment parsing and fixed runtime settings only.
- `domain/`: pure entities, identifiers, enums, and contract values.
- `data/`: structured/document stores and the fixed vector index.
- `ingest/`: source snapshot loading, validation, and normalization orchestration.
- `query/`: query classification and retrieval orchestration.
- `policy/`: evidence, version, conflict, refusal, and answer policy.
- `generation/`: the answer prompt, its guards, and the Ollama chat adapter. It
  imports `domain/` only: the model never sees a policy decision, and a
  generation failure can never change one.
- `evaluation/`: evaluation runners and metric aggregation.
- `api/`: HTTP routing and serialization; it does not fetch source websites directly.
- `observability/`: query, answer, evidence, and evaluation logging adapters.
- `ui/`: static browser assets; it does not import Node runtime modules.

## Naming rules

- Runtime files use `kebab-case.js`.
- Functions and object properties use `camelCase`.
- Fixed identifiers and constant maps use `UPPER_SNAKE_CASE`.
- Stable domain identifiers are explicit strings; array position is never an ID.
- Relative imports stay within the dependency direction enforced by
  `scripts/check-boundaries.js`.

The T01 server remains intentionally minimal. T02–T09 contracts and their
shared validation primitives now live inside these boundaries; later Tasks add
ingestion and RAG implementations without moving the composition root.

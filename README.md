# Genshin Impact RAG Helper

Local-first Traditional Chinese knowledge assistant for Genshin Impact.

## Local start

```powershell
npm ci
Copy-Item .env.example .env
npm start
```

The server listens on `http://127.0.0.1:3000` by default. `GET /health` is the
T01 startup probe. Ollama is configured through `OLLAMA_HOST`; the fixed model
names are recorded in the system design baseline.

For a process without an `.env` file, use `npm run start:local`.

## Checks

```powershell
npm run check
```

`npm run check` validates JavaScript syntax, module boundaries, and all Node
tests. The source layout and dependency direction are documented in
[`src/README.md`](src/README.md). The application currently includes the T01
startup skeleton and the T02–T09 versioned contracts; ingestion and RAG runtime
features arrive in later Tasks.

## Sources

Real source articles are copied by hand into `sources/` as one JSON file each
and converted into an ingest dataset:

```powershell
npm run make:pack -- sources --out artifacts\source-pack.json
npm run ingest:validate -- artifacts\source-pack.json
```

See [`sources/README.md`](sources/README.md) for the article format, the
defaults the converter fills in, and the licence note each source kind carries.

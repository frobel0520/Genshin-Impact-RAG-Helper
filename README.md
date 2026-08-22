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

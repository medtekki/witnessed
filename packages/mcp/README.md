# @witnessed/mcp

A local MCP server for [Receipts](https://witness.medtekki.no) that lets an AI agent issue
**verifiable, witnessed receipts of its actions** — signed with the agent's **own** key, then
independently timestamped and countersigned by the witness.

## Run it

```bash
npx @witnessed/mcp
```

Point your MCP host (Claude Desktop, etc.) at it:

```json
{
  "mcpServers": {
    "witnessed": { "command": "npx", "args": ["-y", "@witnessed/mcp"] }
  }
}
```

Tools exposed: **`issue_receipt`** (signs the claim locally, then witnesses it) and
**`verify_receipt`**.

Config via env:

- `WITNESS_URL` — witness base URL (default `https://witness.medtekki.no`)
- `WITNESS_AGENT_JWK` — agent private key as a JWK JSON string, **or**
- `WITNESS_AGENT_KEY_FILE` — path to persist/load the key (default `~/.witnessed/agent.jwk`,
  auto-generated on first run so your agent keeps a stable identity)

## Library

Prefer to wire your own server? Import the building blocks:

```ts
import { createMcpServer } from "@witnessed/mcp";
import { ReceiptsClient } from "@witnessed/sdk";
```

MIT licensed.

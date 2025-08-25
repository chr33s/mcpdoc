# Examples

This directory contains examples for using mcpdoc with both MCP and UTCP protocols.

## MCP Examples

### Basic MCP Server (stdio)

```bash
mcpdoc --urls "LangGraph:https://langchain-ai.github.io/langgraph/llms.txt" --transport stdio
```

### MCP Server with SSE Transport

```bash
mcpdoc --urls "LangGraph:https://langchain-ai.github.io/langgraph/llms.txt" --transport sse --port 8081
```

## UTCP Examples

### Basic UTCP Server

```bash
mcpdoc --urls "LangGraph:https://langchain-ai.github.io/langgraph/llms.txt" --transport utcp --port 8080
```

### UTCP Server with Multiple Sources

```bash
mcpdoc \
    --config ../sample_config.json \
    --transport utcp \
    --port 8080 \
    --allowed-domains '*'
```

### Testing UTCP Endpoints

Once the UTCP server is running, you can test the endpoints:

```bash
# Tool discovery
curl http://localhost:8080/utcp | jq .

# List documentation sources
curl -X POST http://localhost:8080/tools/list_doc_sources \
     -H "Content-Type: application/json" \
     -d '{}' | jq .

# Fetch documentation
curl -X POST http://localhost:8080/tools/fetch_docs \
     -H "Content-Type: application/json" \
     -d '{"url": "https://langchain-ai.github.io/langgraph/llms.txt"}' | jq .
```

### UTCP Client Example

Using the UTCP SDK to call tools:

```javascript
// See sample_providers.json for provider configuration
const client = await UtcpClient.create({
  providers_file_path: "./sample_providers.json",
});

const tools = await client.toolRepository.getTools();
console.log(
  "Available tools:",
  tools.map((t) => t.name),
);

const result = await client.call_tool("list_doc_sources", {});
console.log("Result:", result);
```

# @jettyd/mcp

MCP server for [jettyd](https://jettyd.com) — gives AI agents direct access to IoT devices.

Connect Claude Desktop, Cursor, Continue, or any MCP-compatible client to your ESP32 devices.

## Install

```bash
npx @jettyd/mcp
```

Or globally:
```bash
npm install -g @jettyd/mcp
```

## Setup

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jettyd": {
      "command": "npx",
      "args": ["@jettyd/mcp"],
      "env": {
        "JETTYD_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Cursor / Continue

Add to your MCP config:
```json
{
  "jettyd": {
    "command": "npx @jettyd/mcp",
    "env": { "JETTYD_API_KEY": "your-api-key" }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `list_devices` | List all devices with status |
| `read_device` | Get current sensor readings |
| `send_command` | Send command to device (relay, LED, etc.) |
| `get_telemetry` | Historical sensor readings |
| `push_rules` | Push JettyScript automation rules |

## Example conversations

> **"What's the temperature in the greenhouse?"**
> → Calls `read_device`, reads shadow, returns current temperature

> **"Turn on the irrigation relay for 30 seconds"**
> → Calls `send_command` with `relay.on` and `{duration: 30000}`

> **"Alert me if temperature goes above 30°C"**
> → Calls `push_rules` with a threshold rule

> **"Show me the humidity trend for the last 24 hours"**
> → Calls `get_telemetry` with metric=air.humidity, period=24h

## Get your API key

Sign up at [jettyd.com](https://jettyd.com) and get your API key from the dashboard.

## Source

[github.com/jettydiot/jettyd-mcp](https://github.com/jettydiot/jettyd-mcp)

MIT licence

#!/usr/bin/env node
/**
 * jettyd MCP Server
 * Gives AI agents (Claude Desktop, Cursor, Continue) direct access to IoT devices.
 *
 * Install: npx @jettyd/mcp
 * Config:  JETTYD_API_KEY=tk_xxx npx @jettyd/mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = process.env.JETTYD_BASE_URL || 'https://api.jettyd.com/v1';
const API_KEY = process.env.JETTYD_API_KEY;

if (!API_KEY) {
  console.error('Error: JETTYD_API_KEY environment variable is required');
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`jettyd API error ${res.status}: ${text}`);
  }
  return res.json();
}

const server = new McpServer({
  name: 'jettyd',
  version: '0.1.0',
});

// ── Tool: list_devices ────────────────────────────────────────────────────────

server.tool(
  'list_devices',
  'List all IoT devices in your jettyd account with their current status and last seen time.',
  {},
  async () => {
    const devices = await api('GET', '/devices');
    if (!devices.length) return { content: [{ type: 'text', text: 'No devices found.' }] };

    const lines = devices.map(d => {
      const dot = d.status === 'online' ? '● online' : d.status === 'provisioning' ? '◐ provisioning' : '○ offline';
      const seen = d.last_seen_at
        ? `last seen ${Math.round((Date.now() - new Date(d.last_seen_at)) / 60000)}m ago`
        : 'never seen';
      return `${d.name} (${d.id.slice(0,8)}...) — ${dot} — ${seen}`;
    });

    return {
      content: [{
        type: 'text',
        text: `${devices.length} device(s):\n${lines.join('\n')}`,
      }],
    };
  }
);

// ── Tool: read_device ─────────────────────────────────────────────────────────

server.tool(
  'read_device',
  'Get the current sensor readings and state for a specific device.',
  { device_id: z.string().describe('Device ID or partial name') },
  async ({ device_id }) => {
    // Try as UUID first, then search by name
    let device;
    try {
      device = await api('GET', `/devices/${device_id}`);
    } catch {
      const all = await api('GET', '/devices');
      device = all.find(d => d.name.toLowerCase().includes(device_id.toLowerCase()) || d.id === device_id);
      if (!device) return { content: [{ type: 'text', text: `No device found matching "${device_id}"` }] };
    }

    const shadow = await api('GET', `/devices/${device.id}/shadow`).catch(() => ({}));
    const reported = shadow.reported || shadow || {};

    const readings = Object.entries(reported)
      .filter(([k]) => !k.startsWith('_') && k !== 'mac_address')
      .map(([k, v]) => `  ${k}: ${typeof v === 'number' ? v.toFixed(2) : v}`)
      .join('\n');

    const seen = device.last_seen_at
      ? `${Math.round((Date.now() - new Date(device.last_seen_at)) / 60000)} minutes ago`
      : 'never';

    return {
      content: [{
        type: 'text',
        text: `Device: ${device.name}\nID: ${device.id}\nStatus: ${device.status}\nLast seen: ${seen}\nFirmware: ${device.firmware_version || 'unknown'}\n\nSensor readings:\n${readings || '  (no readings yet)'}`,
      }],
    };
  }
);

// ── Tool: send_command ────────────────────────────────────────────────────────

server.tool(
  'send_command',
  'Send a command to a device (e.g. turn on a relay, blink an LED, set a value).',
  {
    device_id: z.string().describe('Device ID'),
    action: z.string().describe('Command action (e.g. relay.on, relay.off, led.on, led.off, led.blink, led.toggle)'),
    params: z.record(z.unknown()).optional().describe('Optional parameters (e.g. {"duration": 5000} for timed relay)'),
  },
  async ({ device_id, action, params = {} }) => {
    const result = await api('POST', `/devices/${device_id}/commands`, { action, params });
    return {
      content: [{
        type: 'text',
        text: `Command sent.\nAction: ${action}\nCommand ID: ${result.id}\nStatus: ${result.status || 'pending'}`,
      }],
    };
  }
);

// ── Tool: get_telemetry ───────────────────────────────────────────────────────

server.tool(
  'get_telemetry',
  'Get historical sensor readings for a device over a time period.',
  {
    device_id: z.string().describe('Device ID'),
    metric: z.string().optional().describe('Metric name to filter (e.g. air.temperature). Omit for all metrics.'),
    period: z.enum(['1h', '6h', '24h', '7d']).optional().default('24h').describe('Time period'),
  },
  async ({ device_id, metric, period = '24h' }) => {
    const hours = { '1h': 1, '6h': 6, '24h': 24, '7d': 168 }[period];
    const from = new Date(Date.now() - hours * 3600000).toISOString();
    const params = new URLSearchParams({ from, limit: '200' });
    if (metric) params.set('metric', metric);

    const data = await api('GET', `/devices/${device_id}/telemetry?${params}`);
    if (!data.length) return { content: [{ type: 'text', text: `No telemetry data for the last ${period}.` }] };

    // Summarise by metric
    const grouped = {};
    for (const row of data) {
      for (const [k, v] of Object.entries(row.readings || {})) {
        if (!grouped[k]) grouped[k] = [];
        if (typeof v === 'number') grouped[k].push(v);
      }
    }

    const summary = Object.entries(grouped)
      .filter(([k]) => !metric || k === metric)
      .map(([name, vals]) => {
        if (!vals.length) return null;
        const min = Math.min(...vals).toFixed(2);
        const max = Math.max(...vals).toFixed(2);
        const avg = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
        const latest = vals[vals.length - 1].toFixed(2);
        return `  ${name}: latest=${latest}, avg=${avg}, min=${min}, max=${max} (${vals.length} readings)`;
      })
      .filter(Boolean)
      .join('\n');

    return {
      content: [{
        type: 'text',
        text: `Telemetry summary — last ${period} (${data.length} records)\n\n${summary}`,
      }],
    };
  }
);

// ── Tool: push_rules ──────────────────────────────────────────────────────────

server.tool(
  'push_rules',
  'Push JettyScript automation rules to a device. Rules run on-device and can trigger alerts when sensor thresholds are crossed.',
  {
    device_id: z.string().describe('Device ID'),
    rules: z.array(z.object({
      id: z.string(),
      when: z.object({ type: z.string(), sensor: z.string().optional(), op: z.string().optional(), value: z.number().optional() }),
      then: z.array(z.object({ action: z.string(), params: z.record(z.unknown()).optional() })),
    })).describe('JettyScript rules array'),
  },
  async ({ device_id, rules }) => {
    await api('PUT', `/devices/${device_id}/config`, { rules });
    return {
      content: [{
        type: 'text',
        text: `✅ ${rules.length} rule(s) pushed to device ${device_id}.\nRules are now active on the device.`,
      }],
    };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

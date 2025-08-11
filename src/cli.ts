#!/usr/bin/env node
/**
 * Command-line interface for MCP LLMS-TXT Documentation Server
 */

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { createServer as createHttpServer } from 'http';
import { Command } from 'commander';
import * as YAML from 'yaml';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createServer } from './server.js';
import { SPLASH } from './splash.js';
import type { DocSource, ServerSettings } from './types.js';

// Version from package.json
const VERSION = '0.0.10';

const EPILOG = `
Examples:
  # Directly specifying llms.txt URLs with optional names
  mcpdoc --urls LangGraph:https://langchain-ai.github.io/langgraph/llms.txt
  
  # Using a local file (absolute or relative path)
  mcpdoc --urls LocalDocs:/path/to/llms.txt --allowed-domains '*'
  
  # Using a YAML config file
  mcpdoc --yaml sample_config.yaml

  # Using a JSON config file
  mcpdoc --json sample_config.json

  # Combining multiple documentation sources
  mcpdoc --yaml sample_config.yaml --json sample_config.json --urls LangGraph:https://langchain-ai.github.io/langgraph/llms.txt

  # Using SSE transport with default host (127.0.0.1) and port (8000)
  mcpdoc --yaml sample_config.yaml --transport sse
  
  # Using SSE transport with custom host and port
  mcpdoc --yaml sample_config.yaml --transport sse --host 0.0.0.0 --port 9000
  
  # Using SSE transport with additional HTTP options
  mcpdoc --yaml sample_config.yaml --follow-redirects --timeout 15 --transport sse --host localhost --port 8080
  
  # Allow fetching from additional domains. The domains hosting the llms.txt files are always allowed.
  mcpdoc --yaml sample_config.yaml --allowed-domains https://example.com/ https://another-example.com/
  
  # Allow fetching from any domain
  mcpdoc --yaml sample_config.yaml --allowed-domains '*'
`;

/**
 * Load configuration from a file.
 */
async function loadConfigFile(filePath: string, fileFormat: string): Promise<DocSource[]> {
  try {
    const content = await readFile(resolve(filePath), 'utf-8');
    let config: unknown;

    if (fileFormat.toLowerCase() === 'yaml') {
      config = YAML.parse(content);
    } else if (fileFormat.toLowerCase() === 'json') {
      config = JSON.parse(content);
    } else {
      throw new Error(`Unsupported file format: ${fileFormat}`);
    }

    if (!Array.isArray(config)) {
      throw new Error('Config file must contain a list of doc sources');
    }

    return config as DocSource[];
  } catch (error) {
    console.error(`Error loading config file: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * Create doc sources from a list of URLs or file paths with optional names.
 */
function createDocSourcesFromUrls(urls: string[]): DocSource[] {
  const docSources: DocSource[] = [];
  for (const entry of urls) {
    if (!entry.trim()) {
      continue;
    }
    // Check if it has name:url format (but not if it starts with http: or https:)
    const colonIndex = entry.indexOf(':');
    if (colonIndex > 0 && !entry.startsWith('http:') && !entry.startsWith('https:') && !entry.startsWith('file:')) {
      // Format is name:url - split only on the first colon
      const name = entry.substring(0, colonIndex);
      const url = entry.substring(colonIndex + 1);
      docSources.push({ name, llms_txt: url });
    } else {
      // Format is just url
      docSources.push({ llms_txt: entry });
    }
  }
  return docSources;
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const program = new Command();

  program
    .name('mcpdoc')
    .description('MCP LLMS-TXT Documentation Server')
    .version(VERSION)
    .addHelpText('after', EPILOG);

  // Allow combining multiple doc source methods
  program
    .option('-y, --yaml <file>', 'Path to YAML config file with doc sources')
    .option('-j, --json <file>', 'Path to JSON config file with doc sources')
    .option('-u, --urls <urls...>', 'List of llms.txt URLs or file paths with optional names (format: "url_or_path" or "name:url_or_path")')
    .option('--follow-redirects', 'Whether to follow HTTP redirects', false)
    .option('--allowed-domains <domains...>', 'Additional allowed domains to fetch documentation from. Use "*" to allow all domains.')
    .option('--timeout <seconds>', 'HTTP request timeout in seconds', '10.0')
    .option('--transport <transport>', 'Transport protocol for MCP server', 'stdio')
    .option('--log-level <level>', 'Log level for the server (only used with --transport sse)', 'INFO')
    .option('--host <host>', 'Host to bind the server to (only used with --transport sse)', '127.0.0.1')
    .option('--port <port>', 'Port to bind the server to (only used with --transport sse)', '8000');

  // Parse arguments
  program.parse();
  const options = program.opts();

  // Check if no arguments were provided
  if (process.argv.length === 2) {
    program.help();
    return;
  }

  // Check if any source options were provided
  if (!options.yaml && !options.json && !options.urls) {
    console.error('Error: At least one source option (--yaml, --json, or --urls) is required');
    process.exit(1);
  }

  // Load doc sources based on command-line arguments
  const docSources: DocSource[] = [];

  // Merge doc sources from all provided methods
  if (options.yaml) {
    const yamlSources = await loadConfigFile(options.yaml, 'yaml');
    docSources.push(...yamlSources);
  }
  if (options.json) {
    const jsonSources = await loadConfigFile(options.json, 'json');
    docSources.push(...jsonSources);
  }
  if (options.urls) {
    const urlSources = createDocSourcesFromUrls(options.urls);
    docSources.push(...urlSources);
  }

  // Validate transport option
  if (!['stdio', 'sse'].includes(options.transport)) {
    console.error('Error: --transport must be either "stdio" or "sse"');
    process.exit(1);
  }

  // Server settings for SSE transport
  const settings: ServerSettings = {
    host: options.host,
    port: parseInt(options.port, 10),
    log_level: options.logLevel,
  };

  // Create and configure the server
  const server = await createServer(docSources, {
    followRedirects: options.followRedirects,
    timeout: parseFloat(options.timeout) * 1000, // Convert to milliseconds
    settings,
    allowedDomains: options.allowedDomains || [],
  });

  if (options.transport === 'sse') {
    console.log();
    console.log(SPLASH);
    console.log();
    console.log(`Launching MCPDOC server with ${docSources.length} doc sources`);

    const httpServer = createHttpServer((req, res) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      
      if (url.pathname === '/sse') {
        // Handle SSE connection
        const transport = new SSEServerTransport('/message', res);
        server.connect(transport);
        transport.start();
      } else if (url.pathname === '/message') {
        // Handle POST messages
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            JSON.parse(body);
            // Handle the message - this would normally be done by the transport
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    httpServer.listen(settings.port, settings.host, () => {
      console.log(`SSE server running on http://${settings.host}:${settings.port}/sse`);
    });
  } else {
    // stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

// Run the CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
}

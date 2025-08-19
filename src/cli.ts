#!/usr/bin/env node
/**
 * Command-line interface for MCP LLMS-TXT Documentation Server
 */

import { readFile } from "fs/promises";
import { resolve } from "path";
import { createServer as createHttpServer } from "http";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "./server.js";
import { SPLASH } from "./splash.js";
import type { DocSource, ServerSettings } from "./types.js";
import pkg from "../package.json" with { type: "json" };

const VERSION = pkg.version;

const EPILOG = `
Examples:
	# Directly specifying llms.txt URLs with optional names
	mcpdoc --urls LangGraph:https://langchain-ai.github.io/langgraph/llms.txt
  
	# Using a local file (absolute or relative path)
	mcpdoc --urls LocalDocs:/path/to/llms.txt --allowed-domains '*'
  
	# Using a JSON config file
	mcpdoc --config sample_config.json

	# Combining multiple documentation sources
	mcpdoc --config sample_config.json --urls LangGraph:https://langchain-ai.github.io/langgraph/llms.txt

	# Using SSE transport with default host (127.0.0.1) and port (8000)
	mcpdoc --config sample_config.json --transport sse
  
	# Using SSE transport with custom host and port
	mcpdoc --config sample_config.json --transport sse --host 0.0.0.0 --port 9000
  
	# Using SSE transport with additional HTTP options
	mcpdoc --config sample_config.json --follow-redirects --timeout 15 --transport sse --host localhost --port 8080
  
	# Allow fetching from additional domains. The domains hosting the llms.txt files are always allowed.
	mcpdoc --config sample_config.json --allowed-domains https://example.com/ https://another-example.com/
  
	# Allow fetching from any domain
	mcpdoc --config sample_config.json --allowed-domains '*'
`;

/**
 * Load configuration from a file.
 */
async function loadJsonConfigFile(filePath: string): Promise<DocSource[]> {
	try {
		const content = await readFile(resolve(filePath), "utf-8");
		const config: unknown = JSON.parse(content);

		if (!Array.isArray(config)) {
			throw new Error("Config file must contain a list of doc sources");
		}

		return config as DocSource[];
	} catch (error) {
		console.error(
			`Error loading config file: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(1);
	}
}

/**
 * Create doc sources from a list of URLs or file paths with optional names.
 */
function createDocSourcesFromUrls(urls: string[]): DocSource[] {
	const docSources: DocSource[] = [];
	for (const entry of urls) {
		// Check if it has name:url format (but not if it starts with http: or https:)
		if (!entry.trim()) continue;
		const colonIndex = entry.indexOf(":");
		if (
			colonIndex > 0 &&
			!entry.startsWith("http:") &&
			!entry.startsWith("https:") &&
			!entry.startsWith("file:")
		) {
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

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			config: { type: "string", short: "c" },
			urls: { type: "string", multiple: true, short: "u" },
			"follow-redirects": { type: "boolean", default: false },
			"allowed-domains": { type: "string", multiple: true },
			timeout: { type: "string", default: "10.0" },
			transport: { type: "string", default: "stdio" },
			"log-level": { type: "string", default: "INFO" },
			host: { type: "string", default: "127.0.0.1" },
			port: { type: "string", default: "8000" },
			version: { type: "boolean" },
			help: { type: "boolean" },
		},
		strict: false,
		allowPositionals: true,
	});

	// Show version
	if (values.version) {
		console.log(`mcpdoc v${VERSION}`);
		return;
	}

	const showHelp = () => {
		console.log(`mcpdoc v${VERSION}`);
		console.log();
		console.log("MCP LLMS-TXT Documentation Server");
		console.log();
		console.log("Usage: mcpdoc [options]");
		console.log();
		console.log("Options:");
		console.log(
			"  -c, --config <file>          Path to JSON config file with doc sources",
		);
		console.log(
			"  -u, --urls <urls...>          List of llms.txt URLs or file paths with optional names",
		);
		console.log(
			"                                 (format: 'url_or_path' or 'name:url_or_path')",
		);
		console.log(
			"      --follow-redirects         Whether to follow HTTP redirects (default: false)",
		);
		console.log(
			"      --allowed-domains <domains...> Additional allowed domains. Use '*' to allow all",
		);
		console.log(
			"      --timeout <seconds>        HTTP request timeout in seconds (default: 10.0)",
		);
		console.log(
			"      --transport <transport>    Transport protocol for MCP server (stdio|sse) (default: stdio)",
		);
		console.log(
			"      --log-level <level>        Log level for the server (SSE only) (default: INFO)",
		);
		console.log(
			"      --host <host>              Host to bind the server (SSE only) (default: 127.0.0.1)",
		);
		console.log(
			"      --port <port>              Port to bind the server (SSE only) (default: 8000)",
		);
		console.log("      --version                 Show version");
		console.log("      --help                    Show this help and exit");
		console.log(EPILOG);
	};

	if (values.help || process.argv.length === 2) {
		showHelp();
		return;
	}

	// Merge env overrides (e.g., MCPDOC_TIMEOUT) if provided (prefer parseEnv values, fallback to process.env)
	const timeoutSecondsEnv =
		(process.env.MCPDOC_TIMEOUT as string | undefined) ??
		process.env.MCPDOC_TIMEOUT;
	if (timeoutSecondsEnv && !values.timeout) values.timeout = timeoutSecondsEnv;

	if (!values.config && !values.urls) {
		console.error(
			"Error: At least one source option (--config or --urls) is required",
		);
		process.exit(1);
	}

	// Load doc sources based on command-line arguments
	const docSources: DocSource[] = [];

	// Merge doc sources from all provided methods
	if (typeof values.config === "string") {
		const configSources = await loadJsonConfigFile(values.config);
		docSources.push(...configSources);
	}
	if (Array.isArray(values.urls)) {
		const urlSources = createDocSourcesFromUrls(
			values.urls.filter((u): u is string => typeof u === "string"),
		);
		docSources.push(...urlSources);
	}

	// Validate transport option
	const transport =
		typeof values.transport === "string" ? values.transport : "stdio";
	if (!transport || !["stdio", "sse"].includes(transport)) {
		console.error('Error: --transport must be either "stdio" or "sse"');
		process.exit(1);
	}

	const settings: ServerSettings = {
		host: typeof values.host === "string" ? values.host : "127.0.0.1",
		port: parseInt(typeof values.port === "string" ? values.port : "8000", 10),
		log_level:
			typeof values["log-level"] === "string"
				? (values["log-level"] as string)
				: "INFO",
	};

	const allowedDomains = Array.isArray(values["allowed-domains"])
		? values["allowed-domains"].filter(
				(d): d is string => typeof d === "string",
			)
		: [];

	const server = await createServer(docSources, {
		followRedirects:
			Boolean(values["follow-redirects"]) &&
			values["follow-redirects"] !== "false",
		timeout:
			parseFloat(typeof values.timeout === "string" ? values.timeout : "10.0") *
			1000,
		settings,
		allowedDomains,
	});

	if (transport === "sse") {
		console.log();
		console.log(SPLASH);
		console.log();
		console.log(
			`Launching MCPDOC server with ${docSources.length} doc sources`,
		);

		const httpServer = createHttpServer((req, res) => {
			const url = new URL(req.url || "", `http://${req.headers.host}`);

			if (url.pathname === "/sse") {
				// Handle SSE connection
				const transportInstance = new SSEServerTransport("/message", res);
				server.connect(transportInstance);
				transportInstance.start();
			} else if (url.pathname === "/message") {
				// Handle POST messages
				let body = "";
				req.on("data", (chunk) => (body += chunk));
				req.on("end", () => {
					try {
						JSON.parse(body);
						// Handle the message - this would normally be done by the transport
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ success: true }));
					} catch {
						res.writeHead(400, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: "Invalid JSON" }));
					}
				});
			} else {
				res.writeHead(404);
				res.end("Not Found");
			}
		});

		httpServer.listen(settings.port, settings.host, () => {
			console.log(
				`SSE server running on http://${settings.host}:${settings.port}/sse`,
			);
		});
	} else {
		const transportInstance = new StdioServerTransport();
		await server.connect(transportInstance);
	}
}

// Handle uncaught errors
process.on("uncaughtException", (error) => {
	console.error("Uncaught exception:", error);
	process.exit(1);
});

process.on("unhandledRejection", (reason) => {
	console.error("Unhandled rejection:", reason);
	process.exit(1);
});

// Run the CLI
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error("Error:", error);
		process.exit(1);
	});
}

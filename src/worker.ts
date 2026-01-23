/**
 * Cloudflare Worker entrypoint exposing the MCP LLMS-TXT Documentation Server over SSE.
 *
 * This allows deploying the server as a remote MCP endpoint, similar to
 * https://github.com/cloudflare/mcp-server-cloudflare.
 *
 * Endpoint summary:
 *  GET /sse      -> Establish an SSE stream for MCP messages
 *  POST /message -> Send an MCP client message (JSON) to the server
 *
 * Configuration is provided via environment variables / bindings:
 *  DOC_SOURCES_JSON  - JSON array of { name?, llms_txt, description? } objects
 *  FOLLOW_REDIRECTS  - "true" to follow HTTP redirects
 *  TIMEOUT_MS        - Request timeout in milliseconds (default 10000)
 *  ALLOWED_DOMAINS   - Comma-separated list of additional allowed domains, or '*'
 *
 * NOTE: Local filesystem doc sources are not supported in the Worker runtime.
 */

import { createServer } from "./server.js";
import type { DocSource } from "./types.js";
import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * Minimal in-memory transport adapter for Cloudflare Workers.
 * Implements the MCP Transport interface for SSE communication.
 * We simulate the two-channel (SSE + POST) pattern used in the reference repo.
 *
 * Note: The server instance is memoized per Worker isolate. Configuration changes
 * via environment variables require a new deployment or isolate restart to take effect.
 */
class WorkerSSETransport implements Transport {
	private controller: ReadableStreamDefaultController<string> | null = null;
	private streamController: ReadableStreamDefaultController<string> | null = null;
	onclose?: () => void;
	onerror?: (error: Error) => void;
	onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;

	setStreamController(controller: ReadableStreamDefaultController<string>) {
		this.streamController = controller;
		this.controller = controller;
		// Send an initial comment to open the stream
		this.enqueueRaw(": ok\n\n");
	}

	async start(): Promise<void> {
		// Stream controller is set via setStreamController before connect()
		// This method satisfies the Transport interface
	}

	private enqueueRaw(chunk: string) {
		this.controller?.enqueue(chunk);
	}

	handleMessage(message: unknown, extra?: MessageExtraInfo) {
		if (typeof message === "object" && message !== null) {
			this.onmessage?.(message as JSONRPCMessage, extra);
		}
	}

	async close(): Promise<void> {
		this.onclose?.();
		this.controller?.close();
	}

	async send(message: JSONRPCMessage): Promise<void> {
		// Serialize as SSE data event
		const data = JSON.stringify(message);
		this.enqueueRaw(`event: message\n` + `data: ${data}\n\n`);
	}
}

interface Env {
	DOC_SOURCES_JSON?: string;
	FOLLOW_REDIRECTS?: string;
	TIMEOUT_MS?: string;
	ALLOWED_DOMAINS?: string; // comma separated or '*'
}

// Create (or memoize) the MCP server instance per Worker isolate
let serverPromise: Promise<Server> | null = null;
async function getServer(env: Env) {
	if (!serverPromise) {
		let docSources: DocSource[] = [];
		if (env.DOC_SOURCES_JSON) {
			try {
				docSources = JSON.parse(env.DOC_SOURCES_JSON) as DocSource[];
			} catch (e) {
				console.error("Failed to parse DOC_SOURCES_JSON", e);
			}
		}

		// Filter out any non-http(s) sources (no local file system in Workers)
		docSources = docSources.filter(
			(s) => s.llms_txt.startsWith("http://") || s.llms_txt.startsWith("https://"),
		);

		const allowedDomains = env.ALLOWED_DOMAINS
			? env.ALLOWED_DOMAINS.split(",")
					.map((d) => d.trim())
					.filter(Boolean)
			: [];

		serverPromise = createServer(docSources, {
			followRedirects: env.FOLLOW_REDIRECTS === "true",
			timeout: env.TIMEOUT_MS ? parseInt(env.TIMEOUT_MS, 10) : 10000,
			allowedDomains,
		});
	}
	return serverPromise;
}

// Message queue for POST /message -> outgoing to server transport
const pendingMessages: string[] = [];

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/sse") {
			const server = await getServer(env);

			const stream = new ReadableStream<string>({
				start: (controller) => {
					const transport = new WorkerSSETransport();
					transport.setStreamController(controller);
					void server.connect(transport);

					while (pendingMessages.length) {
						const raw = pendingMessages.shift();
						if (!raw) continue;
						try {
							transport.handleMessage(JSON.parse(raw));
						} catch (e) {
							console.error("Invalid queued message", e);
						}
					}
				},
				cancel: () => {
					// stream closed
				},
			});

			return new Response(stream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache, no-transform",
					Connection: "keep-alive",
					"Access-Control-Allow-Origin": "*",
				},
			});
		}

		if (url.pathname === "/message" && request.method === "POST") {
			const payload = await request.text();
			// If SSE connection already established, push directly; else queue
			pendingMessages.push(payload);
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: {
					"Content-Type": "application/json",
					"Access-Control-Allow-Origin": "*",
				},
			});
		}

		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: {
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type",
				},
			});
		}

		return new Response("Not Found", { status: 404 });
	},
};

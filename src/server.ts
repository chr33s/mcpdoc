/**
 * MCP LLMS-TXT Documentation Server implementation
 */

import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { URL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import TurndownService from "turndown";
import type { DocSource, ServerSettings } from "./types.js";
import {
	createUtcpManual,
	createSuccessResponse,
	createErrorResponse,
	type UtcpToolCallRequest,
	type UtcpToolCallResponse,
} from "./utcp-adapter.js";

/**
 * Extract domain from URL.
 *
 * @param url Full URL
 * @returns Domain with scheme and trailing slash (e.g., https://example.com/)
 */
export function extractDomain(url: string): string {
	const parsed = new URL(url);
	return `${parsed.protocol}//${parsed.host}/`;
}

/**
 * Check if the URL is an HTTP or HTTPS URL.
 */
export function isHttpOrHttps(url: string): boolean {
	return url.startsWith("http:") || url.startsWith("https:");
}

/**
 * Accept paths in file:/// or relative format and map to absolute paths.
 */
export function normalizePath(path: string): string {
	return path.startsWith("file://") ? resolve(path.slice(7)) : resolve(path);
}

/**
 * Get fetch docs tool description.
 */
function getFetchDescription(hasLocalSources: boolean): string {
	const description = [
		"Fetch and parse documentation from a given URL or local file.",
		"",
		"Use this tool after list_doc_sources to:",
		"1. First fetch the llms.txt file from a documentation source",
		"2. Analyze the URLs listed in the llms.txt file",
		"3. Then fetch specific documentation pages relevant to the user's question",
		"",
	];

	if (hasLocalSources) {
		description.push(
			"Args:",
			"    url: The URL or file path to fetch documentation from. Can be:",
			"        - URL from an allowed domain",
			"        - A local file path (absolute or relative)",
			"        - A file:// URL (e.g., file:///path/to/llms.txt)",
		);
	} else {
		description.push("Args:", "    url: The URL to fetch documentation from.");
	}

	description.push(
		"",
		"Returns:",
		"    The fetched documentation content converted to markdown, or an error message",
		"    if the request fails or the URL is not from an allowed domain.",
	);

	return description.join("\n");
}

/**
 * Create the MCP server and generate documentation retrieval tools.
 *
 * @param docSources List of documentation sources to make available
 * @param options Server configuration options
 * @returns A configured MCP server instance
 */
export async function createServer(
	docSources: DocSource[],
	options: {
		followRedirects?: boolean;
		timeout?: number;
		settings?: ServerSettings;
		allowedDomains?: string[];
	} = {},
): Promise<Server> {
	const {
		followRedirects = false,
		timeout = 10000,
		allowedDomains = [],
	} = options;

	const server = new Server(
		{
			name: "llms-txt",
			version: "1.0.0",
		},
		{
			capabilities: {
				tools: {},
			},
		},
	);

	const turndownService = new TurndownService();

	// Separate local and remote sources
	const localSources: DocSource[] = [];
	const remoteSources: DocSource[] = [];

	for (const entry of docSources) {
		if (isHttpOrHttps(entry.llms_txt)) {
			remoteSources.push(entry);
		} else {
			localSources.push(entry);
		}
	}

	// Verify that all local sources exist
	for (const entry of localSources) {
		const absPath = normalizePath(entry.llms_txt);
		try {
			await fs.access(absPath);
		} catch {
			throw new Error(`Local file not found: ${absPath}`);
		}
	}

	// Parse the domain names in the llms.txt URLs
	const domains = new Set(
		remoteSources.map((entry) => extractDomain(entry.llms_txt)),
	);

	// Add additional allowed domains if specified
	if (allowedDomains.includes("*")) {
		domains.clear();
		domains.add("*"); // Special marker for allowing all domains
	} else {
		allowedDomains.forEach((domain) => domains.add(domain));
	}

	const allowedLocalFiles = new Set(
		localSources.map((entry) => normalizePath(entry.llms_txt)),
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => {
		return {
			tools: [
				{
					name: "list_doc_sources",
					description:
						"List all available documentation sources.\n\nThis is the first tool you should call in the documentation workflow.\nIt provides URLs to llms.txt files or local file paths that the user has made available.\n\nReturns:\n    A string containing a formatted list of documentation sources with their URLs or file paths",
					inputSchema: {
						type: "object",
						properties: {},
						required: [],
					},
				},
				{
					name: "fetch_docs",
					description: getFetchDescription(localSources.length > 0),
					inputSchema: {
						type: "object",
						properties: {
							url: {
								type: "string",
								description: "The URL or file path to fetch documentation from",
							},
						},
						required: ["url"],
					},
				},
			],
		};
	});

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args } = request.params;

		if (name === "list_doc_sources") {
			let content = "";
			for (const entry of docSources) {
				const urlOrPath = entry.llms_txt;

				if (isHttpOrHttps(urlOrPath)) {
					const name = entry.name || extractDomain(urlOrPath);
					content += `${name}\nURL: ${urlOrPath}\n\n`;
				} else {
					const path = normalizePath(urlOrPath);
					const name = entry.name || path;
					content += `${name}\nPath: ${path}\n\n`;
				}
			}
			return {
				content: [
					{
						type: "text",
						text: content,
					},
				],
			};
		}

		if (name === "fetch_docs") {
			const url = (args as { url: string }).url?.trim();
			if (!url) {
				return {
					content: [
						{
							type: "text",
							text: "Error: URL parameter is required",
						},
					],
				};
			}

			// Handle local file paths
			if (!isHttpOrHttps(url)) {
				const absPath = normalizePath(url);
				if (!allowedLocalFiles.has(absPath)) {
					return {
						content: [
							{
								type: "text",
								text: `Error: Local file not allowed: ${absPath}. Allowed files: ${Array.from(allowedLocalFiles).join(", ")}`,
							},
						],
					};
				}

				try {
					const content = await fs.readFile(absPath, "utf-8");
					return {
						content: [
							{
								type: "text",
								text: turndownService.turndown(content),
							},
						],
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `Error reading local file: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
					};
				}
			}

			// Handle HTTP/HTTPS URLs
			if (
				!domains.has("*") &&
				!Array.from(domains).some((domain) => url.startsWith(domain))
			) {
				return {
					content: [
						{
							type: "text",
							text: `Error: URL not allowed. Must start with one of the following domains: ${Array.from(domains).join(", ")}`,
						},
					],
				};
			}

			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), timeout);

				const response = await fetch(url, {
					signal: controller.signal,
					redirect: followRedirects ? "follow" : "manual",
				});

				clearTimeout(timeoutId);

				if (!response.ok) {
					return {
						content: [
							{
								type: "text",
								text: `Encountered an HTTP error: ${response.status} ${response.statusText}`,
							},
						],
					};
				}

				let content = await response.text();

				// Check for meta refresh redirect if redirects are enabled
				if (followRedirects) {
					const metaRefreshMatch = content.match(
						/<meta\s+http-equiv=["']?refresh["']?\s+content=["'][^;]+;\s*url=([^"']+)["']/i,
					);

					if (metaRefreshMatch) {
						const redirectUrl = new URL(metaRefreshMatch[1], response.url).href;

						if (
							!domains.has("*") &&
							!Array.from(domains).some((domain) =>
								redirectUrl.startsWith(domain),
							)
						) {
							return {
								content: [
									{
										type: "text",
										text: `Error: Redirect URL not allowed. Must start with one of the following domains: ${Array.from(domains).join(", ")}`,
									},
								],
							};
						}

						const redirectController = new AbortController();
						const redirectTimeoutId = setTimeout(
							() => redirectController.abort(),
							timeout,
						);

						const redirectResponse = await fetch(redirectUrl, {
							signal: redirectController.signal,
						});

						clearTimeout(redirectTimeoutId);

						if (!redirectResponse.ok) {
							return {
								content: [
									{
										type: "text",
										text: `Encountered an HTTP error: ${redirectResponse.status} ${redirectResponse.statusText}`,
									},
								],
							};
						}

						content = await redirectResponse.text();
					}
				}

				return {
					content: [
						{
							type: "text",
							text: turndownService.turndown(content),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Encountered an HTTP error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
				};
			}
		}

		return {
			content: [
				{
					type: "text",
					text: `Unknown tool: ${name}`,
				},
			],
		};
	});

	return server;
}

/**
 * Create UTCP manual for the documentation tools
 *
 * @param docSources List of documentation sources
 * @param baseUrl Base URL for tool endpoints
 * @param options Server configuration options
 * @returns UTCP manual object
 */
export function createUtcpManualForDocs(
	docSources: DocSource[],
	baseUrl: string,
	options: {
		allowedDomains?: string[];
		followRedirects?: boolean;
		timeout?: number;
	} = {},
) {
	return createUtcpManual(docSources, baseUrl, options);
}

/**
 * Execute MCP tool call and return UTCP-compatible response
 *
 * @param request UTCP tool call request
 * @param docSources List of documentation sources
 * @param options Server configuration options
 * @returns UTCP tool call response
 */
export async function executeUtcpToolCall(
	request: UtcpToolCallRequest,
	docSources: DocSource[],
	options: {
		followRedirects?: boolean;
		timeout?: number;
		allowedDomains?: string[];
	} = {},
): Promise<UtcpToolCallResponse> {
	const { tool_name, inputs } = request;
	const {
		followRedirects = false,
		timeout = 10000,
		allowedDomains = [],
	} = options;

	try {
		if (tool_name === "list_doc_sources") {
			let content = "";
			for (const entry of docSources) {
				const urlOrPath = entry.llms_txt;

				if (isHttpOrHttps(urlOrPath)) {
					const name = entry.name || extractDomain(urlOrPath);
					content += `${name}\nURL: ${urlOrPath}\n\n`;
				} else {
					const path = normalizePath(urlOrPath);
					const name = entry.name || path;
					content += `${name}\nPath: ${path}\n\n`;
				}
			}
			return createSuccessResponse({ content });
		}

		if (tool_name === "fetch_docs") {
			const url = inputs.url?.trim();
			if (!url) {
				return createErrorResponse("URL parameter is required");
			}

			// Reuse the MCP logic for fetching docs
			const result = await executeFetchDocs(url, docSources, {
				followRedirects,
				timeout,
				allowedDomains,
			});

			return createSuccessResponse({ content: result });
		}

		return createErrorResponse(`Unknown tool: ${tool_name}`);
	} catch (error) {
		return createErrorResponse(
			`Error executing tool: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Internal function to execute fetch_docs logic (shared between MCP and UTCP)
 */
async function executeFetchDocs(
	url: string,
	docSources: DocSource[],
	options: {
		followRedirects?: boolean;
		timeout?: number;
		allowedDomains?: string[];
	},
): Promise<string> {
	const {
		followRedirects = false,
		timeout = 10000,
		allowedDomains = [],
	} = options;

	// Separate local and remote sources
	const localSources: DocSource[] = [];
	const remoteSources: DocSource[] = [];

	for (const entry of docSources) {
		if (isHttpOrHttps(entry.llms_txt)) {
			remoteSources.push(entry);
		} else {
			localSources.push(entry);
		}
	}

	// Parse the domain names in the llms.txt URLs
	const domains = new Set(
		remoteSources.map((entry) => extractDomain(entry.llms_txt)),
	);

	// Add additional allowed domains if specified
	if (allowedDomains.includes("*")) {
		domains.clear();
		domains.add("*"); // Special marker for allowing all domains
	} else {
		allowedDomains.forEach((domain) => domains.add(domain));
	}

	const allowedLocalFiles = new Set(
		localSources.map((entry) => normalizePath(entry.llms_txt)),
	);

	const turndownService = new TurndownService();

	// Handle local file paths
	if (!isHttpOrHttps(url)) {
		const absPath = normalizePath(url);
		if (!allowedLocalFiles.has(absPath)) {
			throw new Error(
				`Local file not allowed: ${absPath}. Allowed files: ${Array.from(allowedLocalFiles).join(", ")}`,
			);
		}

		try {
			const content = await fs.readFile(absPath, "utf-8");
			return turndownService.turndown(content);
		} catch (error) {
			throw new Error(
				`Error reading local file: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// Handle HTTP/HTTPS URLs
	if (
		!domains.has("*") &&
		!Array.from(domains).some((domain) => url.startsWith(domain))
	) {
		throw new Error(
			`URL not allowed. Must start with one of the following domains: ${Array.from(domains).join(", ")}`,
		);
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	const response = await fetch(url, {
		signal: controller.signal,
		redirect: followRedirects ? "follow" : "manual",
	});

	clearTimeout(timeoutId);

	if (!response.ok) {
		throw new Error(
			`Encountered an HTTP error: ${response.status} ${response.statusText}`,
		);
	}

	let content = await response.text();

	// Check for meta refresh redirect if redirects are enabled
	if (followRedirects) {
		const metaRefreshMatch = content.match(
			/<meta\s+http-equiv=["']refresh["']\s+content=["']\d+;\s*url=([^"']+)["']/i,
		);
		if (metaRefreshMatch && metaRefreshMatch[1]) {
			const redirectUrl = metaRefreshMatch[1];
			const redirectResponse = await fetch(redirectUrl, {
				signal: controller.signal,
				redirect: "follow",
			});

			if (!redirectResponse.ok) {
				throw new Error(
					`Encountered an HTTP error: ${redirectResponse.status} ${redirectResponse.statusText}`,
				);
			}

			content = await redirectResponse.text();
		}
	}

	return turndownService.turndown(content);
}

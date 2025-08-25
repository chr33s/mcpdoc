/**
 * MCP (Model Context Protocol) server implementation
 */

import { promises as fs } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import TurndownService from "turndown";
import type { DocSource, ServerSettings } from "./types.js";
import {
	extractDomain,
	isHttpOrHttps,
	normalizePath,
	getFetchDescription,
	executeFetchDocs,
} from "./server.js";

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

			try {
				const result = await executeFetchDocs(url, docSources, {
					followRedirects,
					timeout,
					allowedDomains,
				});

				return {
					content: [
						{
							type: "text",
							text: result,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error: ${error instanceof Error ? error.message : String(error)}`,
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
/**
 * UTCP (Universal Tool Calling Protocol) implementation for mcpdoc
 * Provides UTCP compatibility layer while maintaining MCP functionality
 */

import type { UtcpManual, Tool, HttpProvider } from "@utcp/sdk/dist/src/shared";
import type { DocSource } from "./types.js";
import { isHttpOrHttps, executeFetchDocs, extractDomain, normalizePath } from "./server.js";

const UTCP_VERSION = "0.1.1";

/**
 * Convert DocSource array to UTCP tools
 */
export function createUtcpTools(
	docSources: DocSource[],
	baseUrl: string,
): Tool[] {
	const tools: Tool[] = [];

	// Create list_doc_sources tool
	tools.push({
		name: "list_doc_sources",
		description:
			"List all available documentation sources.\n\nThis is the first tool you should call in the documentation workflow.\nIt provides URLs to llms.txt files or local file paths that the user has made available.\n\nReturns:\n    A string containing a formatted list of documentation sources with their URLs or file paths",
		inputs: {
			type: "object",
			properties: {},
			required: [],
		},
		outputs: {
			type: "object",
			properties: {
				content: {
					type: "string",
					description: "Formatted list of documentation sources",
				},
			},
			required: ["content"],
		},
		tags: ["documentation", "listing"],
		tool_provider: {
			name: "list_doc_sources_provider",
			provider_type: "http",
			url: `${baseUrl}/tools/list_doc_sources`,
			http_method: "POST",
			content_type: "application/json",
		} as HttpProvider,
	});

	// Create fetch_docs tool
	const hasLocalSources = docSources.some(
		(doc) => !isHttpOrHttps(doc.llms_txt),
	);

	const fetchDescription = getFetchDescription(hasLocalSources);

	tools.push({
		name: "fetch_docs",
		description: fetchDescription,
		inputs: {
			type: "object",
			properties: {
				url: {
					type: "string",
					description: "The URL or file path to fetch documentation from",
				},
			},
			required: ["url"],
		},
		outputs: {
			type: "object",
			properties: {
				content: {
					type: "string",
					description: "The fetched documentation content as Markdown",
				},
			},
			required: ["content"],
		},
		tags: ["documentation", "fetch", "retrieval"],
		tool_provider: {
			name: "fetch_docs_provider",
			provider_type: "http",
			url: `${baseUrl}/tools/fetch_docs`,
			http_method: "POST",
			content_type: "application/json",
		} as HttpProvider,
	});

	return tools;
}

/**
 * Create UTCP manual for the documentation tools
 */
export function createUtcpManual(
	docSources: DocSource[],
	baseUrl: string,
	_options: {
		allowedDomains?: string[];
		followRedirects?: boolean;
		timeout?: number;
	} = {},
): UtcpManual {
	const tools = createUtcpTools(docSources, baseUrl);

	return {
		version: UTCP_VERSION,
		tools,
	};
}

/**
 * Get fetch docs tool description based on whether local sources are available
 */
function getFetchDescription(hasLocalSources: boolean): string {
	const description = [
		"Fetch documentation from a URL or file path.",
		"",
		"This tool retrieves documentation content and converts HTML to Markdown.",
		"For URLs, it fetches the content over HTTP/HTTPS.",
	];

	if (hasLocalSources) {
		description.push(
			"For file paths, it reads from the local filesystem.",
			"",
			"Note: File paths must be absolute or use file:// protocol.",
		);
	}

	description.push(
		"",
		"Security: Only URLs from allowed domains can be fetched.",
		"The tool will return an error if the URL is not from an allowed domain or",
		"if the request fails or the URL is not from an allowed domain.",
	);

	return description.join("\n");
}

/**
 * Validate UTCP tool call request
 */
export interface UtcpToolCallRequest {
	tool_name: string;
	inputs: Record<string, any>;
}

/**
 * UTCP tool call response
 */
export interface UtcpToolCallResponse {
	success: boolean;
	result?: any;
	error?: string;
}

/**
 * Create response for successful tool call
 */
export function createSuccessResponse(result: any): UtcpToolCallResponse {
	return {
		success: true,
		result,
	};
}

/**
 * Create response for failed tool call
 */
export function createErrorResponse(error: string): UtcpToolCallResponse {
	return {
		success: false,
		error,
	};
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

			// Reuse the shared logic for fetching docs
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

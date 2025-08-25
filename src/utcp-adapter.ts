/**
 * UTCP (Universal Tool Calling Protocol) adapter for mcpdoc
 * Provides UTCP compatibility layer while maintaining MCP functionality
 */

import type { UtcpManual, Tool, HttpProvider } from "@utcp/sdk/dist/src/shared";
import type { DocSource } from "./types.js";
import { isHttpOrHttps } from "./server.js";

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

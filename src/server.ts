/**
 * Shared utilities for MCP and UTCP documentation server implementations
 */

import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { URL } from "node:url";
import TurndownService from "turndown";
import type { DocSource } from "./types.js";

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
export function getFetchDescription(hasLocalSources: boolean): string {
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
 * Shared function to execute fetch_docs logic (used by both MCP and UTCP)
 */
export async function executeFetchDocs(
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

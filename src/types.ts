/**
 * TypeScript interfaces for MCP LLMS-TXT Documentation Server
 */

/**
 * A source of documentation for a library or a package.
 */
export interface DocSource {
	/**
	 * Name of the documentation source (optional).
	 */
	name?: string;

	/**
	 * URL to the llms.txt file or documentation source.
	 */
	llms_txt: string;

	/**
	 * Description of the documentation source (optional).
	 */
	description?: string;
}

/**
 * Server settings for SSE transport
 */
export interface ServerSettings {
	host?: string;
	port?: number;
	log_level?: string;
}

/**
 * CLI arguments interface
 */
export interface CLIArgs {
	config?: string;
	urls?: string[];
	followRedirects?: boolean;
	allowedDomains?: string[];
	timeout?: number;
	transport?: "stdio" | "sse" | "utcp";
	logLevel?: string;
	host?: string;
	port?: number;
	version?: boolean;
}

/**
 * Server mode type
 */
export type ServerMode = "mcp" | "utcp" | "hybrid";

/**
 * Extended server settings with UTCP support
 */
export interface ExtendedServerSettings extends ServerSettings {
	mode?: ServerMode;
	utcpPath?: string;
}

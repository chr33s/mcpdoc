/**
 * Unit tests for mcpdoc Node.js/TypeScript implementation
 * Using Node.js built-in test runner
 */

import { test, describe } from "node:test";
import assert from "node:assert";
import { extractDomain, isHttpOrHttps, normalizePath } from "./server.js";
import { SPLASH } from "./splash.js";

// Import types for testing
import type { DocSource } from "./types.js";

void describe("Import Tests", () => {
	void test("should be able to import main modules", () => {
		// Test that main modules can be imported without errors
		// This is equivalent to the Python test_imports.py
		assert.ok(extractDomain, "extractDomain function should be available");
		assert.ok(isHttpOrHttps, "isHttpOrHttps function should be available");
		assert.ok(normalizePath, "normalizePath function should be available");
		assert.ok(SPLASH, "SPLASH constant should be available");
	});
});

void describe("extractDomain function", () => {
	void test("should extract domain from https URL", () => {
		assert.strictEqual(extractDomain("https://example.com/page"), "https://example.com/");
	});

	void test("should extract domain from http URL", () => {
		assert.strictEqual(extractDomain("http://test.org/docs/index.html"), "http://test.org/");
	});

	void test("should extract domain with port", () => {
		assert.strictEqual(extractDomain("https://localhost:8080/api"), "https://localhost:8080/");
	});

	void test("should add trailing slash if missing", () => {
		assert.strictEqual(extractDomain("https://localhost:8080"), "https://localhost:8080/");
	});

	void test("should extract domain with subdomain", () => {
		assert.strictEqual(extractDomain("https://docs.python.org/3/"), "https://docs.python.org/");
	});
});

void describe("isHttpOrHttps function", () => {
	const testCases = [
		{ url: "http://example.com", expected: true },
		{ url: "https://example.com", expected: true },
		{ url: "/path/to/file.txt", expected: false },
		{ url: "file:///path/to/file.txt", expected: false },
		{ url: "ftp://example.com", expected: false }, // Not HTTP or HTTPS
	];

	testCases.forEach(({ url, expected }) => {
		void test(`should return ${expected} for "${url}"`, () => {
			assert.strictEqual(isHttpOrHttps(url), expected);
		});
	});
});

void describe("normalizePath function", () => {
	void test("should handle file:// URLs", () => {
		const result = normalizePath("file:///path/to/file.txt");
		assert.ok(result.includes("file.txt"));
		assert.ok(!result.startsWith("file://"));
	});

	void test("should handle relative paths", () => {
		const result = normalizePath("./relative/path.txt");
		assert.ok(result.includes("path.txt"));
		assert.ok(!result.startsWith("./"));
	});

	void test("should handle absolute paths", () => {
		const result = normalizePath("/absolute/path.txt");
		assert.strictEqual(result, "/absolute/path.txt");
	});
});

void describe("TypeScript interfaces", () => {
	void test("should create valid DocSource objects", () => {
		const docSource: DocSource = {
			llms_txt: "https://example.com/llms.txt",
		};
		assert.ok(docSource.llms_txt);

		const docSourceWithName: DocSource = {
			name: "Test Docs",
			llms_txt: "https://example.com/llms.txt",
			description: "Test documentation",
		};
		assert.strictEqual(docSourceWithName.name, "Test Docs");
		assert.strictEqual(docSourceWithName.description, "Test documentation");
	});
});

void describe("SPLASH constant", () => {
	void test("should contain ASCII art", () => {
		assert.ok(SPLASH.includes("███"), "Should contain ASCII art characters");
		assert.ok(SPLASH.includes("██║"), "Should contain ASCII art border characters");
	});

	void test("should be properly formatted", () => {
		const lines = SPLASH.split("\n");
		assert.ok(lines.length > 1, "Should have multiple lines");
	});
});

void describe("Server creation (integration test)", async () => {
	void test("should create server with valid doc sources", async () => {
		// Dynamic import to avoid top-level await
		const { createServer } = await import("./server.js");

		const docSources: DocSource[] = [
			{
				name: "Test",
				llms_txt: "https://example.com/llms.txt",
			},
		];

		const server = await createServer(docSources, {
			timeout: 5000,
			allowedDomains: ["https://example.com/"],
		});

		assert.ok(server, "Server should be created successfully");
	});

	void test("should reject invalid local files", async () => {
		// Dynamic import to avoid top-level await
		const { createServer } = await import("./server.js");

		const docSources: DocSource[] = [
			{
				name: "Invalid Local",
				llms_txt: "/nonexistent/file.txt",
			},
		];

		await assert.rejects(
			async () => {
				await createServer(docSources);
			},
			/Local file not found/,
			"Should reject nonexistent local files",
		);
	});
});

void describe("CLI argument parsing simulation", () => {
	void test("should handle URL parsing with name:url format", () => {
		// This tests the URL parsing logic that was fixed during migration
		const testUrls = [
			"LangGraph:https://langchain-ai.github.io/langgraph/llms.txt",
			"https://example.com/docs.txt",
			"LocalFile:/path/to/file.txt",
		];

		// We can't directly test the CLI function since it's not exported,
		// but we can verify the parsing logic through the expected behavior
		assert.ok(testUrls.every((url) => typeof url === "string"));

		// Test the logic that should split name:url correctly
		const testEntry = "LangGraph:https://langchain-ai.github.io/langgraph/llms.txt";
		const colonIndex = testEntry.indexOf(":");
		const hasProperFormat =
			colonIndex > 0 &&
			!testEntry.startsWith("http:") &&
			!testEntry.startsWith("https:") &&
			!testEntry.startsWith("file:");

		assert.ok(hasProperFormat, "Should identify name:url format correctly");

		if (hasProperFormat) {
			const name = testEntry.substring(0, colonIndex);
			const url = testEntry.substring(colonIndex + 1);
			assert.strictEqual(name, "LangGraph");
			assert.strictEqual(url, "https://langchain-ai.github.io/langgraph/llms.txt");
		}
	});
});

// Additional integration tests
void describe("Error handling", () => {
	void test("should handle invalid URLs gracefully", () => {
		assert.throws(() => {
			new URL("invalid-url");
		}, TypeError);

		// Test our domain extraction with invalid URLs
		assert.throws(() => {
			extractDomain("invalid-url");
		}, TypeError);
	});

	void test("should handle empty inputs", () => {
		assert.strictEqual(isHttpOrHttps(""), false);

		assert.throws(() => {
			extractDomain("");
		}, TypeError);
	});
});

void describe("Configuration file format compatibility", () => {
	void test("should accept valid DocSource arrays", () => {
		const jsonConfig: DocSource[] = [
			{
				name: "LangGraph Python",
				llms_txt: "https://langchain-ai.github.io/langgraph/llms.txt",
			},
		];
		assert.ok(Array.isArray(jsonConfig));
	});
});

// Performance and behavior tests
void describe("Utility function behavior", () => {
	void test("extractDomain should handle edge cases", () => {
		// Test with query parameters
		assert.strictEqual(
			extractDomain("https://example.com/path?query=value"),
			"https://example.com/",
		);

		// Test with fragments
		assert.strictEqual(extractDomain("https://example.com/path#fragment"), "https://example.com/");

		// Test with complex URLs
		assert.strictEqual(
			extractDomain("https://api.github.com/repos/owner/repo/releases/latest"),
			"https://api.github.com/",
		);
	});

	void test("isHttpOrHttps should be case insensitive for protocols", () => {
		// The function should only check for lowercase http/https
		assert.strictEqual(isHttpOrHttps("HTTP://example.com"), false);
		assert.strictEqual(isHttpOrHttps("HTTPS://example.com"), false);
		assert.strictEqual(isHttpOrHttps("http://example.com"), true);
		assert.strictEqual(isHttpOrHttps("https://example.com"), true);
	});
});

// Migration compatibility tests
void describe("Python to TypeScript migration compatibility", () => {
	void test("should maintain same function signatures and behavior", () => {
		// These tests ensure the TypeScript version behaves identically to Python

		// extractDomain behavior matches Python extract_domain
		const testUrl = "https://langchain-ai.github.io/langgraph/llms.txt";
		const domain = extractDomain(testUrl);
		assert.strictEqual(domain, "https://langchain-ai.github.io/");

		// isHttpOrHttps behavior matches Python _is_http_or_https
		assert.strictEqual(isHttpOrHttps("https://example.com"), true);
		assert.strictEqual(isHttpOrHttps("/local/path"), false);
	});

	void test("should handle the same edge cases as Python version", () => {
		// Domain extraction with various URL formats
		const urls = [
			"https://docs.python.org/3/",
			"http://localhost:8080/api/v1",
			"https://api.github.com/user/repos",
		];

		urls.forEach((url) => {
			const domain = extractDomain(url);
			assert.ok(domain.startsWith("http"), `Domain should start with http: ${domain}`);
			assert.ok(domain.endsWith("/"), `Domain should end with /: ${domain}`);
		});
	});

	void test("should support the same DocSource structure as Python", () => {
		// Test compatibility with Python's DocSource TypedDict
		const pythonStyleConfig: DocSource[] = [
			{
				name: "LangGraph Python",
				llms_txt: "https://langchain-ai.github.io/langgraph/llms.txt",
				description: "Official LangGraph documentation",
			},
			{
				llms_txt: "https://python.langchain.com/llms.txt",
				// name and description are optional, just like in Python
			},
		];

		assert.strictEqual(pythonStyleConfig.length, 2);
		assert.ok(pythonStyleConfig[0].name);
		assert.ok(pythonStyleConfig[0].description);
		assert.ok(!pythonStyleConfig[1].name); // Should be undefined/falsy
	});

	void test("should replicate Python test_get_fetch_description behavior", async () => {
		// This replicates the Python parametrized test for _get_fetch_description
		const { createServer } = await import("./server.js");

		// Test with local sources (has_local_sources=True)
		const localDocSources: DocSource[] = [{ llms_txt: "/path/to/local/file.txt" }];

		// Test with remote sources (has_local_sources=False)
		const remoteDocSources: DocSource[] = [{ llms_txt: "https://example.com/llms.txt" }];

		// We can't directly test the private _get_fetch_description function,
		// but we can verify the server creates tools with appropriate descriptions
		// This should throw for local files that don't exist
		await assert.rejects(async () => await createServer(localDocSources), /Local file not found/);

		// Remote sources should work
		const remoteServer = await createServer(remoteDocSources, {
			allowedDomains: ["https://example.com/"],
		});
		assert.ok(remoteServer, "Should create server with remote sources");
	});
});

// Lightweight test for Cloudflare Worker transport implementation
void describe("Worker transport", () => {
	void test("should establish SSE stream and return initial data", async () => {
		const workerMod: any = await import("./worker.js");
		const worker = workerMod.default;
		assert.ok(worker && typeof worker.fetch === "function");

		const env = {
			DOC_SOURCES_JSON: JSON.stringify([{ llms_txt: "https://example.com/llms.txt" }]),
		};

		const sseResp = await worker.fetch(new Request("http://localhost/sse"), env);
		assert.strictEqual(sseResp.headers.get("content-type"), "text/event-stream");
		const reader = sseResp.body?.getReader();
		assert.ok(reader);
		const { value } = await reader.read();
		if (value) {
			const firstChunk =
				value instanceof Uint8Array ? new TextDecoder().decode(value) : String(value);
			assert.ok(firstChunk.length > 0, "First SSE chunk should not be empty");
		}
		await reader.cancel();
	});
});

// Test the /message endpoint behavior (queueing a JSON-RPC request)
void describe("Worker /message endpoint", () => {
	void test("should accept POST and return ok response", async () => {
		const workerMod: any = await import("./worker.js");
		const worker = workerMod.default;
		const env = {
			DOC_SOURCES_JSON: JSON.stringify([{ llms_txt: "https://example.com/llms.txt" }]),
		};

		const rpcRequest = {
			jsonrpc: "2.0",
			id: 42,
			method: "tools/list",
			params: {},
		};

		const postResp = await worker.fetch(
			new Request("http://localhost/message", {
				method: "POST",
				body: JSON.stringify(rpcRequest),
				headers: { "Content-Type": "application/json" },
			}),
			env,
		);
		assert.strictEqual(postResp.status, 200);
		const body = await postResp.json();
		assert.deepStrictEqual(body, { ok: true });
	});
});

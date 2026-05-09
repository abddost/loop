import { resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { AcpClient, AcpProtocolError } from "../../server/loop/cursor/acp/client"
import type { SessionNotification } from "../../server/loop/cursor/acp/types"

/**
 * Integration tests for AcpClient. Spawns a tiny mock agent (mock-acp-agent.mjs)
 * via `node` and exercises the full handshake + prompt + notification path.
 *
 * The mock's behaviour is driven by env vars so each test case can shape the
 * conversation without bespoke fixtures.
 */

const MOCK_PATH = resolve(__dirname, "fixtures/mock-acp-agent.mjs")

async function withClient(
	env: NodeJS.ProcessEnv,
	fn: (client: AcpClient) => Promise<void>,
): Promise<void> {
	const client = new AcpClient({
		command: "node",
		args: [MOCK_PATH],
		env: { ...process.env, ...env },
	})
	await client.start()
	try {
		await fn(client)
	} finally {
		await client.dispose()
	}
}

describe("AcpClient + mock agent", () => {
	let activeClients: AcpClient[] = []
	afterEach(async () => {
		for (const c of activeClients) {
			await c.dispose()
		}
		activeClients = []
	})

	it("completes initialize → authenticate → newSession handshake", async () => {
		await withClient({}, async (client) => {
			const init = await client.initialize({
				protocolVersion: 1,
				clientInfo: { name: "test", version: "0.0.0" },
			})
			expect(init.protocolVersion).toBe(1)

			const auth = await client.authenticate({ methodId: "cursor_login" })
			expect(auth).toBeDefined()

			const session = await client.newSession({
				cwd: "/tmp",
				mcpServers: [],
			})
			expect(session.sessionId).toMatch(/^mock-session-/)
			expect(session.modes?.availableModes ?? []).toHaveLength(2)
			expect(session.models?.availableModels?.length).toBeGreaterThan(0)
		})
	})

	it("streams session/update notifications during a prompt", async () => {
		await withClient({}, async (client) => {
			await client.initialize({
				protocolVersion: 1,
				clientInfo: { name: "test", version: "0.0.0" },
			})
			await client.authenticate({ methodId: "cursor_login" })
			const session = await client.newSession({ cwd: "/tmp", mcpServers: [] })

			const updates: SessionNotification[] = []
			client.onSessionUpdate((u) => {
				updates.push(u)
			})

			const resp = await client.prompt({
				sessionId: session.sessionId,
				prompt: [{ type: "text", text: "hi" }],
			})
			expect(resp.stopReason).toBe("end_turn")
			// Allow the final update events to drain.
			await new Promise((r) => setTimeout(r, 50))

			const messageChunks = updates.filter((u) => u.update.sessionUpdate === "agent_message_chunk")
			expect(messageChunks.length).toBeGreaterThanOrEqual(2)
			const usage = updates.find((u) => u.update.sessionUpdate === "usage_update")
			expect(usage).toBeDefined()
		})
	})

	it("relays tool_call and tool_call_update notifications", async () => {
		await withClient({ MOCK_AGENT_EMIT_TOOL_CALL: "1" }, async (client) => {
			await client.initialize({
				protocolVersion: 1,
				clientInfo: { name: "test", version: "0.0.0" },
			})
			await client.authenticate({ methodId: "cursor_login" })
			const session = await client.newSession({ cwd: "/tmp", mcpServers: [] })

			const updates: SessionNotification[] = []
			client.onSessionUpdate((u) => updates.push(u))

			await client.prompt({
				sessionId: session.sessionId,
				prompt: [{ type: "text", text: "go" }],
			})
			await new Promise((r) => setTimeout(r, 50))

			const toolCall = updates.find((u) => u.update.sessionUpdate === "tool_call")
			const toolUpdate = updates.find((u) => u.update.sessionUpdate === "tool_call_update")
			expect(toolCall).toBeDefined()
			expect(toolUpdate).toBeDefined()
		})
	})

	it("invokes the registered request-permission handler with full payload", async () => {
		await withClient({ MOCK_AGENT_REQUIRE_PERMISSION: "1" }, async (client) => {
			await client.initialize({
				protocolVersion: 1,
				clientInfo: { name: "test", version: "0.0.0" },
			})
			await client.authenticate({ methodId: "cursor_login" })
			const session = await client.newSession({ cwd: "/tmp", mcpServers: [] })

			let permissionRequest: unknown
			client.onRequestPermission(async (req) => {
				permissionRequest = req
				return { outcome: { outcome: "selected", optionId: "allow-once" } }
			})

			await client.prompt({
				sessionId: session.sessionId,
				prompt: [{ type: "text", text: "go" }],
			})

			expect(permissionRequest).toBeDefined()
			const tc = (permissionRequest as { toolCall?: { toolCallId?: string } }).toolCall
			expect(tc?.toolCallId).toBe("tc-2")
		})
	})

	it("forwards session/cancel as a fire-and-forget notification", async () => {
		await withClient({}, async (client) => {
			await client.initialize({
				protocolVersion: 1,
				clientInfo: { name: "test", version: "0.0.0" },
			})
			await client.authenticate({ methodId: "cursor_login" })
			const session = await client.newSession({ cwd: "/tmp", mcpServers: [] })
			// Should not throw and should not return a Promise that rejects.
			expect(() => client.cancel({ sessionId: session.sessionId })).not.toThrow()
		})
	})

	it("rejects requests after dispose", async () => {
		const client = new AcpClient({
			command: "node",
			args: [MOCK_PATH],
			env: process.env,
		})
		await client.start()
		await client.dispose()
		await expect(
			client.initialize({
				protocolVersion: 1,
				clientInfo: { name: "test", version: "0.0.0" },
			}),
		).rejects.toThrow()
	})

	it("surfaces a typed AcpProtocolError on agent-side errors", async () => {
		await withClient({}, async (client) => {
			await client.initialize({
				protocolVersion: 1,
				clientInfo: { name: "test", version: "0.0.0" },
			})
			await client.authenticate({ methodId: "cursor_login" })
			// session/set_mode for a session that doesn't exist throws nothing
			// in our mock (it always echoes), so use loadSession with a
			// sessionId we never created — the mock returns method-not-found
			// because it doesn't implement loadSession.
			await expect(
				client.loadSession({ sessionId: "ghost", cwd: "/tmp", mcpServers: [] }),
			).rejects.toBeInstanceOf(AcpProtocolError)
		})
	})
})

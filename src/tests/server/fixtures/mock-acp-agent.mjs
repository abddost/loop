#!/usr/bin/env node
/**
 * Tiny mock ACP agent for integration tests.
 *
 * Speaks NDJSON-framed JSON-RPC 2.0 over stdio. Behavior is driven by
 * environment variables so each test case can shape the response set:
 *
 *   MOCK_AGENT_AVAILABLE_MODELS  comma-separated list of model ids to
 *                                advertise in session/new
 *   MOCK_AGENT_PROMPT_RESPONSE   one of "end_turn"|"cancelled"|"refusal"
 *   MOCK_AGENT_EMIT_TOOL_CALL    "1" → emit a tool_call session/update
 *                                during the prompt
 *   MOCK_AGENT_REQUIRE_PERMISSION  "1" → send session/request_permission
 *                                 during the prompt and wait for the
 *                                 response before completing
 */

import { createInterface } from "node:readline"

const send = (msg) => {
	process.stdout.write(`${JSON.stringify(msg)}\n`)
}

const sendResp = (id, result) => send({ jsonrpc: "2.0", id, result })
const sendErr = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } })
const sendNotif = (method, params) => send({ jsonrpc: "2.0", method, params })

const availableModels = (process.env.MOCK_AGENT_AVAILABLE_MODELS || "demo-model")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean)
	.map((id) => ({ id, displayName: id, parameters: [] }))

const stopReason = process.env.MOCK_AGENT_PROMPT_RESPONSE || "end_turn"
const emitToolCall = process.env.MOCK_AGENT_EMIT_TOOL_CALL === "1"
const requirePermission = process.env.MOCK_AGENT_REQUIRE_PERMISSION === "1"

let createdSessionId
const pendingPermission = new Map() // requestId → resolve

const rl = createInterface({ input: process.stdin })
rl.on("line", (line) => {
	if (!line.trim()) return
	let msg
	try {
		msg = JSON.parse(line)
	} catch {
		return
	}

	// Permission response from the host
	if (msg.id != null && (msg.result || msg.error) && pendingPermission.has(msg.id)) {
		const resolve = pendingPermission.get(msg.id)
		pendingPermission.delete(msg.id)
		resolve(msg.result)
		return
	}

	if (typeof msg.method !== "string") return
	switch (msg.method) {
		case "initialize":
			sendResp(msg.id, {
				protocolVersion: 1,
				agentCapabilities: {},
				agentInfo: { name: "mock-acp-agent", version: "0.0.1" },
			})
			return
		case "authenticate":
			sendResp(msg.id, {})
			return
		case "session/new": {
			createdSessionId = `mock-session-${Date.now()}`
			sendResp(msg.id, {
				sessionId: createdSessionId,
				configOptions: [{ id: "model", category: "model", currentValue: availableModels[0]?.id }],
				modes: {
					availableModes: [
						{ id: "default", name: "Build" },
						{ id: "plan", name: "Plan" },
					],
					currentModeId: "default",
				},
				models: { availableModels, currentModelId: availableModels[0]?.id ?? null },
			})
			return
		}
		case "session/set_config_option":
			sendResp(msg.id, {
				configOptions: [{ id: msg.params.configId, currentValue: msg.params.value }],
			})
			return
		case "session/set_mode":
			sendNotif("session/update", {
				sessionId: msg.params.sessionId,
				update: { sessionUpdate: "current_mode_update", currentModeId: msg.params.modeId },
			})
			sendResp(msg.id, {})
			return
		case "session/cancel":
			// No response — it's a notification.
			return
		case "session/prompt": {
			const sid = msg.params.sessionId
			;(async () => {
				sendNotif("session/update", {
					sessionId: sid,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "Hello " },
					},
				})
				sendNotif("session/update", {
					sessionId: sid,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "world" },
					},
				})
				if (emitToolCall) {
					sendNotif("session/update", {
						sessionId: sid,
						update: {
							sessionUpdate: "tool_call",
							toolCallId: "tc-1",
							title: "Read foo.ts",
							kind: "read",
							status: "in_progress",
							rawInput: { path: "foo.ts" },
						},
					})
					sendNotif("session/update", {
						sessionId: sid,
						update: {
							sessionUpdate: "tool_call_update",
							toolCallId: "tc-1",
							status: "completed",
							content: [{ type: "content", content: { type: "text", text: "// foo" } }],
						},
					})
				}
				if (requirePermission) {
					const reqId = `perm-${Date.now()}`
					const resp = await new Promise((resolve) => {
						pendingPermission.set(reqId, resolve)
						send({
							jsonrpc: "2.0",
							id: reqId,
							method: "session/request_permission",
							params: {
								sessionId: sid,
								toolCall: {
									toolCallId: "tc-2",
									title: "Run dangerous command",
									kind: "execute",
									status: "pending",
									rawInput: { command: "rm -rf /tmp/test" },
								},
								options: [
									{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
									{ optionId: "reject-once", name: "Reject", kind: "reject_once" },
								],
							},
						})
					})
					sendNotif("session/update", {
						sessionId: sid,
						update: {
							sessionUpdate: "agent_message_chunk",
							content: { type: "text", text: ` (permission outcome: ${JSON.stringify(resp)})` },
						},
					})
				}
				sendNotif("session/update", {
					sessionId: sid,
					update: {
						sessionUpdate: "usage_update",
						size: 200000,
						used: 1234,
						cost: { amount: 0.01, currency: "USD" },
					},
				})
				sendResp(msg.id, { stopReason })
			})()
			return
		}
		default:
			sendErr(msg.id, -32601, `mock: method not implemented: ${msg.method}`)
	}
})

rl.on("close", () => process.exit(0))

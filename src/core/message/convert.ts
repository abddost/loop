import type { AssistantModelMessage, ModelMessage, ToolModelMessage } from "ai"
import type { MessageWithParts } from "../schema/message"
import type { Part } from "../schema/part"

type TextItem = { type: "text"; text: string }

/**
 * Converts a user-role Part to Vercel AI SDK user text content items.
 * @param part - The part to convert
 * @returns Array of text content items for user messages
 */
function userPartToContent(part: Part): TextItem[] {
	switch (part.type) {
		case "text":
			return [{ type: "text", text: part.text }]
		case "file":
			return [{ type: "text", text: `[File: ${part.path} (${part.mimeType})]` }]
		case "subtask":
			return [
				{
					type: "text",
					text: `[Tool executed by user: ${part.agent} — ${part.description}${part.command ? ` (${part.command})` : ""}]`,
				},
			]
		case "compaction":
			return [
				{
					type: "text",
					text: "Here is a summary of what we have done so far. Continue from where we left off.",
				},
			]
		default:
			return []
	}
}

/**
 * Converts assistant-role Parts to Vercel AI SDK assistant content items and
 * collects tool results for a subsequent tool message.
 * @param parts - The parts to convert
 * @returns An object with assistant content and tool results
 */
function assistantPartsToContent(parts: Part[]): {
	content: AssistantModelMessage["content"]
	toolResults: ToolModelMessage["content"]
} {
	const content: NonNullable<Exclude<AssistantModelMessage["content"], string>> = []
	const toolResults: ToolModelMessage["content"] = []

	for (const part of parts) {
		switch (part.type) {
			case "text":
				content.push({ type: "text" as const, text: part.text })
				break
			case "reasoning":
				content.push({ type: "text" as const, text: part.text })
				break
			case "tool": {
				content.push({
					type: "tool-call" as const,
					toolCallId: part.callId,
					toolName: part.tool,
					input: part.input ?? {},
				})
				const outputText =
					part.time?.compacted === true
						? "[Old tool result content cleared]"
						: (part.output ?? part.error ?? "")
				toolResults.push({
					type: "tool-result" as const,
					toolCallId: part.callId,
					toolName: part.tool,
					output: { type: "text" as const, value: outputText },
				})
				break
			}
			// step-start, step-finish, edit, retry, snapshot are metadata — skip
			default:
				break
		}
	}

	return { content, toolResults }
}

/**
 * Converts an array of MessageWithParts into Vercel AI SDK CoreMessage format.
 *
 * Rules:
 * - CompactionPart becomes a summary text
 * - SubtaskPart becomes text about tool execution by user
 * - ToolPart with time.compacted becomes "[Old tool result content cleared]"
 * - User messages map to CoreUserMessage with content array
 * - Assistant messages map to CoreAssistantMessage + optional CoreToolMessage
 *
 * @param messages - The messages to convert
 * @returns An array of CoreMessage objects for the AI SDK
 */
export function toModelMessages(messages: MessageWithParts[]): ModelMessage[] {
	const result: ModelMessage[] = []

	for (const msg of messages) {
		if (msg.role === "user") {
			const contentItems: Array<{ type: "text"; text: string }> = []
			for (const part of msg.parts) {
				const items = userPartToContent(part)
				for (const item of items) {
					contentItems.push(item)
				}
			}
			if (contentItems.length > 0) {
				result.push({
					role: "user" as const,
					content: contentItems,
				})
			}
		} else {
			const { content, toolResults } = assistantPartsToContent(msg.parts)
			if (content.length > 0) {
				result.push({
					role: "assistant" as const,
					content,
				})
			}
			if (toolResults.length > 0) {
				result.push({
					role: "tool" as const,
					content: toolResults,
				})
			}
		}
	}

	return result
}

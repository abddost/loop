/**
 * Async session title generation.
 *
 * Generates a concise, descriptive title from the first user message.
 * Runs as fire-and-forget -- never blocks the main conversation.
 * Only runs once per session (skips if title is already set).
 */

import type { SessionContext } from './context.js';
import type { ProviderConfig } from '@coding-assistant/shared';

/**
 * Generate a session title from the user message text.
 *
 * This is designed to be called with `.catch(() => {})` so failures
 * are silent. Title generation is non-critical; a missing title is
 * far better than a blocked conversation.
 */
export async function generateSessionTitle(
  workspaceId: string,
  session: SessionContext,
  userMessageText: string,
  modelString: string,
  providerConfigs: Record<string, ProviderConfig>,
): Promise<void> {
  // Already has a title -- skip
  if (session.title) return;

  // Need at least some user text to generate from
  if (!userMessageText || !userMessageText.trim()) return;

  try {
    const { streamText, stepCountIs } = await import('ai');
    const { resolveModel } = await import('../providers/index.js');
    const { titleAgent } = await import('../agents/profiles/title.js');

    const resolved = resolveModel(
      titleAgent.model ?? modelString,
      providerConfigs,
    );

    const result = streamText({
      model: resolved.provider(resolved.modelId),
      system: titleAgent.systemPrompt,
      messages: [{
        role: 'user' as const,
        content: `The following is the text to summarize:\n<text>\n${userMessageText}\n</text>`,
      }],
      maxOutputTokens: titleAgent.maxOutputTokens,
      temperature: titleAgent.temperature,
      stopWhen: stepCountIs(1),
    });

    const text = await result.text;
    if (text && text.trim()) {
      session.title = text.trim().slice(0, 50); // Enforce 50-char limit

      // Emit event for UI update
      const { globalEventBus } = await import('../events/bus.js');
      const titleEvent: Omit<import('@coding-assistant/shared').SessionTitleUpdatedEvent, 'globalSeq'> = {
        type: 'session-title-updated',
        workspaceId,
        sessionId: session.id,
        title: session.title,
        timestamp: new Date().toISOString(),
      };
      globalEventBus.emit(titleEvent as Omit<import('@coding-assistant/shared').StreamEvent, 'globalSeq'>);
    }
  } catch {
    // Non-critical: title generation failure is silent
  }
}

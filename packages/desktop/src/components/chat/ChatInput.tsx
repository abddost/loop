/**
 * ChatInput -- textarea with agent selector, model selector, and send/stop button.
 *
 * Handles Enter-to-send (Shift+Enter for newline).
 * When streaming, the send button becomes a stop button.
 */

import { useState, useRef, useEffect } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import { CircularProgress } from '@openai/apps-sdk-ui/components/Indicator';
import { Menu } from '@openai/apps-sdk-ui/components/Menu';
import { ArrowUp, Stop, ChevronDown } from '@openai/apps-sdk-ui/components/Icon';
import { ModelSelector } from '../ModelSelector';
import type { ModelOption, TokenUsage, AgentInfo } from '../../types';

// ---------------------------------------------------------------------------
//  Token usage ring
// ---------------------------------------------------------------------------

/** Circular progress ring showing context utilization using @openai/apps-sdk-ui. */
function TokenUsageRing({ usage, totalCost, contextLimit: contextLimitProp }: { usage: TokenUsage; totalCost?: number; contextLimit?: number }) {
  const limit = contextLimitProp ?? 128_000;
  const pct = Math.min((usage.totalTokens / limit) * 100, 100);
  const isNearPruning = pct >= 85;

  // Color thresholds: green < 50%, amber 50-80%, red > 80%
  const trackColor =
    pct < 50 ? 'var(--color-green-500)' :
    pct < 80 ? 'var(--color-amber-500)' :
    'var(--color-red-500)';

  const tooltipContent = [
    `Input: ${usage.inputTokens.toLocaleString()}`,
    `Output: ${usage.outputTokens.toLocaleString()}`,
    `Total: ${usage.totalTokens.toLocaleString()} / ${limit.toLocaleString()}`,
    totalCost != null && totalCost > 0 ? `Session cost: $${totalCost.toFixed(4)}` : null,
    isNearPruning ? '⚠ Near context limit — older messages may be pruned' : null,
  ].filter(Boolean).join('\n');

  return (
    <Tooltip content={tooltipContent}>
      <CircularProgress
        progress={pct}
        size={22}
        strokeWidth={2}
        trackActiveColor={trackColor}
        className="cursor-default"
      />
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
//  ChatInput
// ---------------------------------------------------------------------------

interface ChatInputProps {
  onSend: (text: string) => void;
  isStreaming: boolean;
  onCancel: () => void;
  agents: AgentInfo[];
  selectedAgent: string;
  onAgentChange: (agent: string) => void;
  model: string;
  effort: string;
  models: ModelOption[];
  onModelChange: (model: string) => void;
  onEffortChange: (effort: string) => void;
  /** Token usage from the latest assistant message */
  usage?: TokenUsage | null;
  /** Estimated cost for the latest assistant message */
  totalCost?: number;
  /** Context limit from the selected model */
  contextLimit?: number;
}

export function ChatInput({
  onSend,
  isStreaming,
  onCancel,
  agents,
  selectedAgent,
  onAgentChange,
  model,
  effort,
  models,
  onModelChange,
  onEffortChange,
  usage,
  totalCost,
  contextLimit,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentAgent = agents.find((a) => a.id === selectedAgent) ?? agents[0];

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) return; // Don't send while streaming
      handleSend();
    }
  };

  return (
    <div className="border-t border-subtle px-4 py-3">
      <div className="max-w-3xl mx-auto">
        <div className="relative rounded-xl border border-default bg-surface transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask for follow-up changes"
            rows={1}
            className="w-full bg-transparent px-4 pt-3 pb-10 text-sm text-default placeholder:text-tertiary resize-none overflow-auto max-h-[200px] focus:outline-none focus-visible:outline-none"
          />

          {/* Bottom toolbar inside textarea */}
          <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1 px-2 py-1.5">
            {/* Agent selector */}
            <Menu>
              <Menu.Trigger>
                <Button
                  variant="ghost"
                  color="secondary"
                  size="sm"
                  className="text-xs! text-secondary gap-1!"
                >
                  {currentAgent?.name ?? 'Agent'}
                  <ChevronDown className="size-3" />
                </Button>
              </Menu.Trigger>
              <Menu.Content side="top" align="start" minWidth={240}>
                <Menu.RadioGroup value={selectedAgent} onChange={onAgentChange}>
                  {agents.map((a) => (
                    <Menu.RadioItem key={a.id} value={a.id}>
                      <div className="flex flex-col">
                        <span className="text-xs font-medium">{a.name}</span>
                        <span className="text-[10px] text-tertiary">{a.description}</span>
                      </div>
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
              </Menu.Content>
            </Menu>

            {/* Divider */}
            <span className="text-tertiary text-xs">·</span>

            {/* Model selector */}
            <ModelSelector
              model={model}
              effort={effort}
              models={models}
              onModelChange={onModelChange}
              onEffortChange={onEffortChange}
            />

            {/* Spacer */}
            <div className="flex-1" />

            {/* Token usage ring */}
            {usage && <TokenUsageRing usage={usage} totalCost={totalCost} contextLimit={contextLimit} />}

            {/* Send / Stop button */}
            <Button
              color={isStreaming ? 'secondary' : 'primary'}
              size="sm"
              onClick={isStreaming ? onCancel : handleSend}
              disabled={!isStreaming && !input.trim()}
              className="rounded-full! size-8! p-0! flex items-center justify-center"
            >
              {isStreaming ? (
                <Stop className="size-3.5" />
              ) : (
                <ArrowUp className="size-3.5" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

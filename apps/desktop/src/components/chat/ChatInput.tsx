/**
 * ChatInput -- textarea with model selector and send button.
 *
 * Handles Enter-to-send (Shift+Enter for newline).
 */

import { useState, useRef } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Plus, ArrowUp } from '@openai/apps-sdk-ui/components/Icon';
import { ModelSelector } from '../ModelSelector';
import type { ModelOption } from '../../types';

interface ChatInputProps {
  onSend: (text: string) => void;
  model: string;
  effort: string;
  models: ModelOption[];
  onModelChange: (model: string) => void;
  onEffortChange: (effort: string) => void;
}

export function ChatInput({
  onSend,
  model,
  effort,
  models,
  onModelChange,
  onEffortChange,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-subtle px-4 py-3">
      <div className="max-w-3xl mx-auto">
        <div className="relative rounded-xl border border-default bg-surface focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask for follow-up changes"
            rows={1}
            className="w-full bg-transparent px-4 pt-3 pb-10 text-sm text-default placeholder:text-tertiary resize-none focus:outline-none"
          />

          {/* Bottom toolbar inside textarea */}
          <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1 px-2 py-1.5">
            {/* Plus button */}
            <Button variant="ghost" color="secondary" size="sm">
              <Plus className="size-3.5" />
            </Button>

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

            {/* Send button */}
            <Button
              color="primary"
              size="sm"
              onClick={handleSend}
              disabled={!input.trim()}
              className="rounded-full! size-8! p-0! flex items-center justify-center"
            >
              <ArrowUp className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

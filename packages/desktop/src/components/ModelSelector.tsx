/**
 * ModelSelector -- dropdown for choosing the AI model and effort level.
 * Driven by props (real enabled models from useModels), not hardcoded values.
 */

import { useState, useRef, useEffect } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { ChevronDown, Check } from '@openai/apps-sdk-ui/components/Icon';
import type { ModelOption } from '../types';
import { EFFORTS } from '../constants';

export type { ModelOption };

interface ModelSelectorProps {
  model: string;
  effort: string;
  models: ModelOption[];
  onModelChange: (model: string) => void;
  onEffortChange: (effort: string) => void;
}

export function ModelSelector({
  model,
  effort,
  models,
  onModelChange,
  onEffortChange,
}: ModelSelectorProps) {
  const [modelOpen, setModelOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const modelRef = useRef<HTMLDivElement>(null);
  const effortRef = useRef<HTMLDivElement>(null);

  const currentModel = models.find((m) => m.id === model) ?? models[0];
  const currentEffort = EFFORTS.find((e) => e.id === effort) ?? EFFORTS[EFFORTS.length - 1];

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
      if (effortRef.current && !effortRef.current.contains(e.target as Node)) {
        setEffortOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="flex items-center gap-1">
      {/* Model selector */}
      <div className="relative" ref={modelRef}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setModelOpen(!modelOpen); setEffortOpen(false); }}
          className="text-xs! text-secondary gap-1!"
        >
          {currentModel?.label ?? 'Select model'}
          <ChevronDown className="size-3" />
        </Button>
        {modelOpen && (
          <div className="absolute bottom-full left-0 mb-1 w-56 rounded-lg border border-default bg-surface shadow-lg py-1 z-50 max-h-64 overflow-y-auto">
            {models.length === 0 ? (
              <div className="px-3 py-2 text-xs text-tertiary">
                No models enabled. Open Settings to enable models.
              </div>
            ) : (
              models.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { onModelChange(m.id); setModelOpen(false); }}
                  className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs transition-colors ${
                    m.id === model
                      ? 'bg-surface-tertiary text-default'
                      : 'text-secondary hover:bg-surface-tertiary'
                  }`}
                >
                  {m.id === model && <Check className="size-3 text-blue-500" />}
                  <span className={m.id !== model ? 'ml-5' : ''}>{m.label}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Divider */}
      <span className="text-tertiary text-xs">·</span>

      {/* Effort selector */}
      <div className="relative" ref={effortRef}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setEffortOpen(!effortOpen); setModelOpen(false); }}
          className="text-xs! text-secondary gap-1!"
        >
          {currentEffort.label}
          <ChevronDown className="size-3" />
        </Button>
        {effortOpen && (
          <div className="absolute bottom-full left-0 mb-1 w-40 rounded-lg border border-default bg-surface shadow-lg py-1 z-50">
            {EFFORTS.map((e) => (
              <button
                key={e.id}
                onClick={() => { onEffortChange(e.id); setEffortOpen(false); }}
                className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs transition-colors ${
                  e.id === effort
                    ? 'bg-surface-tertiary text-default'
                    : 'text-secondary hover:bg-surface-tertiary'
                }`}
              >
                {e.id === effort && <Check className="size-3 text-blue-500" />}
                <span className={e.id !== effort ? 'ml-5' : ''}>{e.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

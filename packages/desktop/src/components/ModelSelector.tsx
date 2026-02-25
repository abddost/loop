/**
 * ModelSelector -- dropdown for choosing the AI model and effort level.
 * Uses @openai/apps-sdk-ui Menu.RadioGroup for accessible, keyboard-navigable dropdowns.
 */

import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Menu } from '@openai/apps-sdk-ui/components/Menu';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import { ChevronDown } from '@openai/apps-sdk-ui/components/Icon';
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
  const currentModel = models.find((m) => m.id === model) ?? models[0];
  const currentEffort = EFFORTS.find((e) => e.id === effort) ?? EFFORTS[EFFORTS.length - 1];

  return (
    <div className="flex items-center gap-1">
      {/* Model selector */}
      <Menu>
        <Tooltip content="Select AI model" compact gutterSize="sm" contentClassName="text-xs">
          <Menu.Trigger>
            <Button
              variant="ghost"
              color="secondary"
              size="sm"
              className="text-xs! text-secondary gap-1!"
            >
              {currentModel?.label ?? 'Select model'}
              <ChevronDown className="size-3" />
            </Button>
          </Menu.Trigger>
        </Tooltip>
        <Menu.Content side="top" align="start" minWidth={220} maxHeight={256}>
          {models.length === 0 ? (
            <Menu.Item disabled>
              <span className="text-xs text-tertiary">No models enabled. Open Settings to enable models.</span>
            </Menu.Item>
          ) : (
            <Menu.RadioGroup value={model} onChange={onModelChange}>
              {models.map((m) => (
                <Menu.RadioItem key={m.id} value={m.id}>
                  <span className="text-xs">{m.label}</span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          )}
        </Menu.Content>
      </Menu>

      {/* Divider */}
      <span className="text-tertiary text-xs">·</span>

      {/* Effort selector */}
      <Menu>
        <Tooltip content="Set effort level" compact gutterSize="sm" contentClassName="text-xs">
          <Menu.Trigger>
            <Button
              variant="ghost"
              color="secondary"
              size="sm"
              className="text-xs! text-secondary gap-1!"
            >
              {currentEffort.label}
              <ChevronDown className="size-3" />
            </Button>
          </Menu.Trigger>
        </Tooltip>
        <Menu.Content side="top" align="start" minWidth={140}>
          <Menu.RadioGroup value={effort} onChange={onEffortChange}>
            {EFFORTS.map((e) => (
              <Menu.RadioItem key={e.id} value={e.id}>
                <span className="text-xs">{e.label}</span>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu>
    </div>
  );
}

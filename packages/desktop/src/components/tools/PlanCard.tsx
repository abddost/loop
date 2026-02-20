/**
 * PlanCard -- card for plan-save tool calls.
 *
 * Three states:
 * 1. Inline (default): compact card with plan preview and expand button
 * 2. Expanded: shows full markdown content within the card
 * 3. Fullscreen overlay: takes over the chat area with close button
 */

import { memo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { ShimmerableText } from '@openai/apps-sdk-ui/components/ShimmerText';
import { ChevronDown, ChevronRight, X } from '@openai/apps-sdk-ui/components/Icon';
import { Markdown } from '@openai/apps-sdk-ui/components/Markdown';
import { useApiClient } from '../../lib/api-client-provider';
import type { ToolCallPart, ToolResultPart } from '../../types';

interface PlanCardProps {
  part: ToolCallPart;
  isRunning: boolean;
  isError: boolean;
  result?: ToolResultPart;
  workspaceId: string;
  onApproveAndBuild?: (planPath: string) => void;
  isStreaming?: boolean;
}

type ViewState = 'inline' | 'expanded' | 'fullscreen';

export const PlanCard = memo(function PlanCard({ part, isRunning, isError, result, workspaceId, onApproveAndBuild, isStreaming }: PlanCardProps) {
  const [viewState, setViewState] = useState<ViewState>('inline');
  const [savingToWorkspace, setSavingToWorkspace] = useState(false);
  const [savedToWs, setSavedToWs] = useState(false);
  const [approved, setApproved] = useState(false);
  const apiClient = useApiClient();

  const title = (part.args?.title as string) ?? 'Untitled Plan';
  const content = (part.args?.content as string) ?? '';
  const savedToWorkspace = (part.args?.saveToWorkspace as boolean) || savedToWs;

  const resultData = result?.output as { text?: string; planId?: string; paths?: string[]; savedToWorkspace?: boolean } | string | undefined;
  const planId = typeof resultData === 'object' ? resultData?.planId : undefined;
  const planPath = typeof resultData === 'object' ? resultData?.paths?.[0] : undefined;
  const resultText = typeof resultData === 'object' ? resultData?.text : (typeof resultData === 'string' ? resultData : undefined);

  const toggleExpand = useCallback(() => {
    setViewState((prev) => prev === 'expanded' ? 'inline' : 'expanded');
  }, []);

  const toggleFullscreen = useCallback(() => {
    setViewState((prev) => prev === 'fullscreen' ? 'inline' : 'fullscreen');
  }, []);

  const handleSaveToWorkspace = useCallback(async () => {
    if (!planId) return;

    setSavingToWorkspace(true);
    try {
      await apiClient.savePlanToWorkspace(planId, workspaceId);
      setSavedToWs(true);
    } catch (err) {
      console.error('Failed to save plan to workspace:', err);
    } finally {
      setSavingToWorkspace(false);
    }
  }, [apiClient, planId, workspaceId]);

  if (isRunning) {
    return (
      <div className="py-0.5 flex items-center gap-1.5">
        <ShimmerableText shimmer className="text-sm text-tertiary">
          Saving plan...
        </ShimmerableText>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-0.5 text-sm text-red-500">
        Failed to save plan
      </div>
    );
  }

  // Fullscreen overlay -- rendered via portal to escape parent overflow/transform traps
  const fullscreenOverlay = viewState === 'fullscreen' ? createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ backgroundColor: 'var(--color-bg-canvas, #0d0d0d)' }}
    >
      <div className="flex items-center justify-between px-6 py-3 border-b border-subtle">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-default">{title}</h2>
          <Badge color="success" variant="soft" size="sm">saved</Badge>
          {savedToWorkspace && (
            <Badge color="info" variant="soft" size="sm">workspace</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!savedToWorkspace && (
            <Button
              variant="ghost"
              color="secondary"
              size="sm"
              onClick={handleSaveToWorkspace}
              disabled={savingToWorkspace}
              className="text-xs!"
            >
              {savingToWorkspace ? 'Saving...' : 'Save to workspace'}
            </Button>
          )}
          {onApproveAndBuild && planPath && !approved && (
            <Button
              variant="solid"
              color="primary"
              size="sm"
              onClick={() => { setApproved(true); onApproveAndBuild(planPath); }}
              disabled={isStreaming}
              className="text-xs!"
            >
              {isStreaming ? 'Waiting...' : 'Approve and Build'}
            </Button>
          )}
          {approved && (
            <Badge color="success" variant="soft" size="sm">approved</Badge>
          )}
          <Button variant="ghost" color="secondary" size="sm" onClick={toggleFullscreen}>
            <X className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4 max-w-4xl mx-auto w-full">
        <div className="prose prose-sm text-default">
          <Markdown>{content}</Markdown>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      {fullscreenOverlay}
      <div className="mt-2 rounded-xl border border-default bg-surface overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2">
            <button onClick={toggleExpand} className="text-tertiary hover:text-secondary transition-colors">
              {viewState === 'expanded' ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>
            <div className="text-xs font-medium text-secondary">{title}</div>
            <Badge color="success" variant="soft" size="sm">saved</Badge>
            {savedToWorkspace && (
              <Badge color="info" variant="soft" size="sm">workspace</Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {!savedToWorkspace && (
              <Button
                variant="ghost"
                color="secondary"
                size="sm"
                onClick={handleSaveToWorkspace}
                disabled={savingToWorkspace}
                className="text-[10px]!"
              >
                {savingToWorkspace ? 'Saving...' : 'Save to workspace'}
              </Button>
            )}
            {onApproveAndBuild && planPath && !approved && (
              <Button
                variant="solid"
                color="primary"
                size="sm"
                onClick={() => { setApproved(true); onApproveAndBuild(planPath); }}
                disabled={isStreaming}
                className="text-[10px]!"
              >
                {isStreaming ? 'Waiting...' : 'Approve and Build'}
              </Button>
            )}
            {approved && (
              <Badge color="success" variant="soft" size="sm">approved</Badge>
            )}
            <Button variant="ghost" color="secondary" size="sm" onClick={toggleFullscreen} className="text-[10px]!">
              {viewState === 'fullscreen' ? 'close fullscreen' : 'fullscreen'}
            </Button>
          </div>
        </div>

        {/* Inline preview or expanded content (hidden when fullscreen) */}
        {viewState === 'inline' && content && (
          <div className="px-4 pb-2.5 max-h-[200px] overflow-hidden relative">
            <div className="text-xs text-tertiary leading-relaxed whitespace-pre-wrap">
              {content.slice(0, 500)}
              {content.length > 500 ? '...' : ''}
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-surface to-transparent" />
          </div>
        )}

        {viewState === 'expanded' && content && (
          <div className="px-4 pb-3 max-h-[600px] overflow-y-auto bg-surface-secondary/50">
            <div className="prose prose-sm text-default">
              <Markdown>{content}</Markdown>
            </div>
          </div>
        )}

        {/* Saved path */}
        {resultText && (
          <div className="px-4 pb-2.5 text-[10px] text-tertiary truncate">
            {resultText}
          </div>
        )}
      </div>
    </>
  );
});

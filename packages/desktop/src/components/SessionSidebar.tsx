/**
 * SessionSidebar -- Cursor-style sidebar with workspaces, sessions, and theme toggle.
 *
 * Wrapped in React.memo to prevent re-renders during streaming (the sidebar
 * props don't change when only session messages are updating).
 */

import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import { Menu } from '@openai/apps-sdk-ui/components/Menu';
import { LoadingIndicator } from '@openai/apps-sdk-ui/components/Indicator';
import { Animate } from '@openai/apps-sdk-ui/components/Transition';
import {
  Plus,
  Settings,
  FolderOpen,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  DotsHorizontal,
  Trash,
} from '@openai/apps-sdk-ui/components/Icon';
import { useState, memo, useMemo } from 'react';
import { ThemeToggle } from './ThemeToggle';
import type { WorkspaceInfo, SessionInfo } from '../types';

/** Format a date string as a short relative time: "now", "5m", "3h", "2d", "4w" */
function relativeTime(dateStr?: string): string | null {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return null;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

interface SessionSidebarProps {
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string | null;
  sessions: SessionInfo[];
  activeSessionId: string | null;
  onSelectWorkspace: (id: string) => void;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onOpenWorkspace: () => void;
  onOpenSettings: () => void;
  onDeleteWorkspace: (id: string) => void;
  onDeleteSession: (workspaceId: string, sessionId: string) => void;
  width: number;
}

export const SessionSidebar = memo(function SessionSidebar({
  workspaces,
  activeWorkspaceId,
  sessions,
  activeSessionId,
  onSelectWorkspace,
  onSelectSession,
  onNewSession,
  onOpenWorkspace,
  onOpenSettings,
  onDeleteWorkspace,
  onDeleteSession,
  width,
}: SessionSidebarProps) {
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(
    new Set(activeWorkspaceId ? [activeWorkspaceId] : []),
  );

  const toggleWorkspace = (id: string) => {
    const next = new Set(expandedWorkspaces);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setExpandedWorkspaces(next);
  };

  return (
    <div
      className="glass-sidebar flex flex-col h-full relative z-10"
      style={{ width, minWidth: width }}
    >
      {/* New Thread button */}
      <div className="p-4">
        <Button
          color="secondary"
          variant="soft"
          size="md"
          block
          onClick={onNewSession}
        >
          <Plus className="size-3.5" />
          New Chat
        </Button>
      </div>

      {/* Workspaces section label */}
      <div className="px-4 py-1 flex items-center justify-between">
        <span className="text-[11px] font-medium text-tertiary uppercase tracking-wider">
          Workspaces
        </span>
        <div className="flex items-center gap-0.5">
          <Tooltip content="Add workspace">
            <Button
              variant="ghost"
              color="secondary"
              size="sm"
              className="p-1!"
              onClick={onOpenWorkspace}
            >
              <FolderPlus className="size-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Workspaces + Sessions list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {workspaces.map((ws) => {
          const isExpanded = expandedWorkspaces.has(ws.id);
          const isActive = ws.id === activeWorkspaceId;

          return (
            <div key={ws.id}>
              {/* Workspace row -- single container with actions inside */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  onSelectWorkspace(ws.id);
                  toggleWorkspace(ws.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onSelectWorkspace(ws.id);
                    toggleWorkspace(ws.id);
                  }
                }}
                className={`group w-full flex items-center gap-2 p-1 rounded-lg text-sm transition-colors cursor-pointer ${
                  isActive
                    ? 'text-default bg-surface-tertiary'
                    : 'text-secondary hover:bg-surface-tertiary'
                }`}
              >
                {isExpanded ? (
                  <ChevronDown className="size-3 text-tertiary shrink-0" />
                ) : (
                  <ChevronRight className="size-3 text-tertiary shrink-0" />
                )}
                <FolderOpen className="size-3.5 text-tertiary shrink-0" />
                <span className="truncate font-medium">{ws.name}</span>

                {/* Hover actions inside the row -- opacity transition keeps DOM stable for Radix */}
                <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Tooltip content="New session">
                    <Button
                      variant="ghost"
                      color="secondary"
                      size="sm"
                      className="p-1!"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectWorkspace(ws.id);
                        onNewSession();
                      }}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </Tooltip>
                  <Menu>
                    <Menu.Trigger>
                      <Button
                        variant="ghost"
                        color="secondary"
                        size="sm"
                        className="p-1!"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DotsHorizontal className="size-3.5" />
                      </Button>
                    </Menu.Trigger>
                    <Menu.Content side="bottom" align="end" minWidth={160}>
                      <Menu.Item onSelect={() => onDeleteWorkspace(ws.id)}>
                        <Trash className="size-3.5 text-red-500" />
                        <span className="ml-2">Delete workspace</span>
                      </Menu.Item>
                    </Menu.Content>
                  </Menu>
                </div>
              </div>

              {/* Sessions under this workspace */}
              <Animate
                as="div"
                transitionPosition="static"
                initial={{ opacity: 0, y: -8 }}
                enter={{ opacity: 1, y: 0, duration: 150 }}
                exit={{ opacity: 0, y: -8, duration: 100 }}
              >
                {isExpanded && isActive && (
                  <div key="sessions" className="ml-4 mt-0.5 space-y-0.5">
                    {sessions.map((session) => (
                      <div
                        key={session.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectSession(session.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            onSelectSession(session.id);
                          }
                        }}
                        className={`group/session relative w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${
                          session.id === activeSessionId
                            ? 'bg-surface-tertiary text-default'
                            : 'text-secondary hover:bg-surface-tertiary'
                        }`}
                      >
                        <SessionStatusIndicator status={session.status} />
                        <span className="truncate flex-1">{session.title || session.agentId}</span>

                        {/* Relative time -- hidden on hover when menu shows */}
                        {session.createdAt && (
                          <span className="text-[11px] text-tertiary shrink-0 group-hover/session:opacity-0 transition-opacity">
                            {relativeTime(session.createdAt)}
                          </span>
                        )}

                        {/* Session menu inside the row -- overlaps the time on hover */}
                        <div className="absolute right-1 flex items-center opacity-0 group-hover/session:opacity-100 transition-opacity">
                          <Menu>
                            <Menu.Trigger>
                              <Button
                                variant="ghost"
                                color="secondary"
                                size="sm"
                                className="p-1!"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <DotsHorizontal className="size-3.5" />
                              </Button>
                            </Menu.Trigger>
                            <Menu.Content side="bottom" align="end" minWidth={160}>
                              <Menu.Item onSelect={() => onDeleteSession(ws.id, session.id)}>
                                <Trash className="size-3.5 text-red-500" />
                                <span className="ml-2">Delete session</span>
                              </Menu.Item>
                            </Menu.Content>
                          </Menu>
                        </div>
                      </div>
                    ))}

                    {sessions.length === 0 && (
                      <div className="text-center text-tertiary text-xs py-4">
                        No sessions yet
                      </div>
                    )}
                  </div>
                )}
              </Animate>
            </div>
          );
        })}

        {workspaces.length === 0 && (
          <div className="text-center py-8 space-y-3">
            <p className="text-sm text-tertiary">No workspaces open</p>
            <Button
              variant="soft"
              color="secondary"
              size="sm"
              onClick={onOpenWorkspace}
            >
              <FolderOpen className="size-3.5" />
              Open Folder
            </Button>
          </div>
        )}
      </div>

      {/* Bottom: Settings + Theme */}
      <div className="p-2 border-t border-subtle space-y-2">
        <div className="flex items-center justify-between px-1">
          <SidebarNavItem icon={Settings} label="Settings" onClick={onOpenSettings} />
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
});

/** Session status indicator using SDK LoadingIndicator for busy states */
function SessionStatusIndicator({ status }: { status: string }) {
  switch (status) {
    case 'busy':
      return <LoadingIndicator size={14} strokeWidth={2} className="shrink-0" />;
    case 'retry':
      return <LoadingIndicator size={14} strokeWidth={2} className="shrink-0 text-yellow-500" />;
    case 'error':
      return <span className="size-2 rounded-full bg-red-500 shrink-0" />;
    default:
      return null;
  }
}

/** Reusable sidebar nav item */
function SidebarNavItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm text-secondary hover:bg-surface-tertiary transition-colors"
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

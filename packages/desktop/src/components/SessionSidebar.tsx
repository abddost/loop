/**
 * SessionSidebar -- Cursor-style sidebar with workspaces, sessions, navigation, and theme toggle.
 */

import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import {
  Plus,
  Bolt,
  Sparkles,
  Settings,
  FolderOpen,
  Chat,
  ChevronDown,
  ChevronRight,
  Filter,
  Archive,
} from '@openai/apps-sdk-ui/components/Icon';
import { useState } from 'react';
import { ThemeToggle } from './ThemeToggle';
import type { WorkspaceInfo, SessionInfo } from '../types';

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
}

export function SessionSidebar({
  workspaces,
  activeWorkspaceId,
  sessions,
  activeSessionId,
  onSelectWorkspace,
  onSelectSession,
  onNewSession,
  onOpenWorkspace,
  onOpenSettings,
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

  const statusDotClass = (status: string) => {
    switch (status) {
      case 'busy':
        return 'bg-blue-500 animate-pulse';
      case 'error':
        return 'bg-red-500';
      case 'retry':
        return 'bg-yellow-500';
      default:
        return 'bg-current opacity-20';
    }
  };

  return (
    <div className="glass-sidebar w-[260px] min-w-[260px] flex flex-col h-full relative z-10">
      {/* New Thread button */}
      <div className="p-3">
        <Button
          color="secondary"
          variant="soft"
          size="sm"
          block
          onClick={onNewSession}
        >
          <Plus className="size-3.5" />
          New thread
        </Button>
      </div>

      {/* Navigation items */}
      <nav className="px-2 space-y-0.5">
        <SidebarNavItem icon={Bolt} label="Automations" />
        <SidebarNavItem icon={Sparkles} label="Skills" />
      </nav>

      {/* Divider */}
      <div className="mx-3 my-2 border-t border-subtle" />

      {/* Threads section label */}
      <div className="px-4 py-1 flex items-center justify-between">
        <span className="text-[11px] font-medium text-tertiary uppercase tracking-wider">
          Threads
        </span>
        <div className="flex items-center gap-0.5">
          <Tooltip content="Filter">
            <Button variant="ghost" color="secondary" size="sm" className="p-1!">
              <Filter className="size-3" />
            </Button>
          </Tooltip>
          <Tooltip content="Archive">
            <Button variant="ghost" color="secondary" size="sm" className="p-1!">
              <Archive className="size-3" />
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
              {/* Workspace header */}
              <button
                onClick={() => {
                  onSelectWorkspace(ws.id);
                  toggleWorkspace(ws.id);
                }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
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
                {ws.sessionCount > 0 && (
                  <Badge size="lg" className="ml-auto text-tertiary">
                    {ws.sessionCount}
                  </Badge>
                )}
              </button>

              {/* Sessions under this workspace */}
              {isExpanded && isActive && (
                <div className="ml-4 mt-0.5 space-y-0.5">
                  {sessions.map((session) => (
                    <button
                      key={session.id}
                      onClick={() => onSelectSession(session.id)}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                        session.id === activeSessionId
                          ? 'bg-surface-tertiary text-default'
                          : 'text-secondary hover:bg-surface-tertiary'
                      }`}
                    >
                      <Chat className="size-3.5 shrink-0 text-tertiary" />
                      <span className="truncate">{session.agentId}</span>
                      <div className={`size-1.5 rounded-full shrink-0 ml-auto ${statusDotClass(session.status)}`} />
                    </button>
                  ))}

                  {sessions.length === 0 && (
                    <div className="text-center text-tertiary text-xs py-4">
                      No sessions yet
                    </div>
                  )}
                </div>
              )}
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

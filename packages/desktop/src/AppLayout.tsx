/**
 * AppLayout -- main layout component using hooks for state management.
 *
 * Separated from App.tsx so that all hooks can access
 * ApiClientProvider and EventStoreProvider contexts.
 */

import { useState, useCallback, useRef } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { FolderOpen, ChatCompose } from '@openai/apps-sdk-ui/components/Icon';
import { Animate } from '@openai/apps-sdk-ui/components/Transition';
import { pickDirectory } from './lib/pick-directory';
import { useWorkspace } from './hooks/useWorkspace';
import { useSession } from './hooks/useSession';
import { useModels } from './hooks/useModels';
import { useProviders } from './hooks/useProviders';
import { useAppConfig } from './hooks/useAppConfig';
import { useLiveSessionStatuses } from './hooks/useLiveSessionStatuses';
import { SessionSidebar } from './components/SessionSidebar';
import { ChatPanel } from './components/ChatPanel';
import { TopBar } from './components/TopBar';
import { StatusBar } from './components/StatusBar';
import { SettingsModal } from './components/settings/SettingsModal';
import { ErrorBoundary } from './components/ErrorBoundary';

interface AppLayoutProps {
  connected: boolean;
}

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 260;

export function AppLayout({ connected }: AppLayoutProps) {
  // State hooks -- all use ApiClient from context internally
  const workspace = useWorkspace();
  const session = useSession(workspace.activeWorkspaceId);
  const models = useModels();
  const providers = useProviders();
  const appConfig = useAppConfig(models);

  // Agent selection (hardcoded for now)
  const [selectedAgent, setSelectedAgent] = useState('coder');
  const handleAgentChange = useCallback((agent: string) => setSelectedAgent(agent), []);

  // Settings modal
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Sidebar toggle ──
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem('sidebar-open') !== 'false',
  );

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar-open', String(next));
      return next;
    });
  }, []);

  // ── Sidebar resize ──
  const [sidebarWidth, setSidebarWidth] = useState(
    () => Number(localStorage.getItem('sidebar-width')) || SIDEBAR_DEFAULT,
  );
  const resizingRef = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const newWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + (ev.clientX - startX)));
      requestAnimationFrame(() => setSidebarWidth(newWidth));
    };

    const onMouseUp = () => {
      resizingRef.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Persist final width
      setSidebarWidth((w) => {
        localStorage.setItem('sidebar-width', String(w));
        return w;
      });
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  // Handlers
  const handleOpenWorkspace = async () => {
    const rootPath = await pickDirectory();
    if (rootPath) {
      await workspace.open(rootPath);
    }
  };

  const handleDeleteWorkspace = useCallback((id: string) => {
    workspace.close(id);
  }, [workspace]);

  const handleDeleteSession = useCallback((_workspaceId: string, sessionId: string) => {
    session.deleteSession(sessionId);
  }, [session]);

  // Derived values
  const { activeWorkspaceId } = workspace;
  const { activeSessionId, activeSession } = session;
  const sessionTitle = activeSession?.agentId ?? null;

  // Merge real-time statuses from EventStore into the API-fetched session list
  const liveSessions = useLiveSessionStatuses(activeWorkspaceId, session.sessions);

  // Pass sidebar width as CSS variable for gradient mesh sync
  const shellStyle = sidebarOpen
    ? { '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties
    : { '--sidebar-width': '0px' } as React.CSSProperties;

  return (
    <>
      <div className="app-shell h-screen flex bg-surface text-default" style={shellStyle}>
        {/* Sidebar with slide animation */}
        <Animate
          as="div"
          className="h-screen"
          transitionPosition="static"
          initial={{ opacity: 0, x: -20 }}
          enter={{ opacity: 1, x: 0, duration: 200 }}
          exit={{ opacity: 0, x: -20, duration: 150 }}
        >
          {sidebarOpen && (
            <div key="sidebar" className="relative h-screen">
              <SessionSidebar
                workspaces={workspace.workspaces}
                activeWorkspaceId={activeWorkspaceId}
                sessions={liveSessions}
                activeSessionId={activeSessionId}
                onSelectWorkspace={workspace.setActiveWorkspaceId}
                onSelectSession={session.setActiveSessionId}
                onNewSession={session.createSession}
                onOpenWorkspace={handleOpenWorkspace}
                onOpenSettings={() => setSettingsOpen(true)}
                onDeleteWorkspace={handleDeleteWorkspace}
                onDeleteSession={handleDeleteSession}
                width={sidebarWidth}
              />
              {/* Resize handle */}
              <div
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize z-20
                           hover:bg-blue-500/30 active:bg-blue-500/40 transition-colors"
                onMouseDown={handleResizeStart}
              />
            </div>
          )}
        </Animate>

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <TopBar
            sessionTitle={sessionTitle}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={handleToggleSidebar}
          />

          {/* Content */}
          {activeWorkspaceId && activeSessionId ? (
            <ErrorBoundary>
            <ChatPanel
              workspaceId={activeWorkspaceId}
              sessionId={activeSessionId}
              agent={selectedAgent}
              onAgentChange={handleAgentChange}
              model={appConfig.selectedModel}
              effort={appConfig.selectedEffort}
              models={appConfig.enabledModels}
              onModelChange={appConfig.handleModelChange}
              onEffortChange={appConfig.handleEffortChange}
            />
            </ErrorBoundary>
          ) : (
            /* Empty state */
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-4 max-w-sm">
                <h1 className="text-xl font-semibold text-default">Coding Assistant</h1>
                <p className="text-sm text-tertiary">
                  {!connected
                    ? 'Connecting to server...'
                    : !activeWorkspaceId
                      ? 'Open a workspace to get started'
                      : 'Create a session to begin chatting'}
                </p>
                {!activeWorkspaceId && connected && (
                  <Button
                    color="primary"
                    onClick={handleOpenWorkspace}
                  >
                    <FolderOpen className="size-4" />
                    Open Workspace
                  </Button>
                )}
                {activeWorkspaceId && !activeSessionId && (
                  <Button
                    color="primary"
                    onClick={session.createSession}
                  >
                    <ChatCompose className="size-4" />
                    New Session
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Status bar */}
          <StatusBar
            connected={connected}
            workspaceId={activeWorkspaceId}
          />
        </div>
      </div>

      {/* Settings modal -- data pre-loaded at startup */}
      <ErrorBoundary>
        <SettingsModal
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          providers={providers}
          models={models}
        />
      </ErrorBoundary>
    </>
  );
}

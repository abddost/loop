/**
 * AppLayout -- main layout component using hooks for state management.
 *
 * Separated from App.tsx so that all hooks can access
 * ApiClientProvider and EventStoreProvider contexts.
 */

import { useState, useCallback, useRef, useMemo, useEffect, useSyncExternalStore, lazy, Suspense } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { FolderOpen, ChatCompose } from '@openai/apps-sdk-ui/components/Icon';
import { Animate } from '@openai/apps-sdk-ui/components/Transition';
import { pickDirectory } from './lib/pick-directory';
import { useWorkspace } from './hooks/useWorkspace';
import { useSession } from './hooks/useSession';
import { useModels } from './hooks/useModels';
import { useProviders } from './hooks/useProviders';
import { useAppConfig } from './hooks/useAppConfig';
import { useAgents } from './hooks/useAgents';
import { useLiveSessionStatuses } from './hooks/useLiveSessionStatuses';
import { useEventStore } from './store/store-provider';
import { SessionSidebar } from './components/SessionSidebar';
import { ChatPanel } from './components/ChatPanel';
import { TopBar } from './components/TopBar';
import { StatusBar } from './components/StatusBar';
import { ErrorBoundary } from './components/ErrorBoundary';

const LazySettingsModal = lazy(() =>
  import('./components/settings/SettingsModal').then((m) => ({ default: m.SettingsModal })),
);

interface AppLayoutProps {
  connected: boolean;
}

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 260;

export function AppLayout({ connected }: AppLayoutProps) {
  // State hooks -- all use ApiClient from context internally
  const workspace = useWorkspace();
  const { activeWorkspaceId } = workspace;
  const session = useSession(activeWorkspaceId);
  const {
    activeSessionId,
    activeSession,
    sessions: rawSessions,
    setActiveSessionId,
    createSession,
    deleteSession: deleteSessionFn,
    refreshSessions,
  } = session;
  const models = useModels();
  const providers = useProviders();
  const appConfig = useAppConfig(models);

  // Agent selection (fetched from backend)
  const agentsHook = useAgents();

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

  // Handlers -- all wrapped in useCallback with stable deps to preserve React.memo
  const handleOpenWorkspace = useCallback(async () => {
    const rootPath = await pickDirectory();
    if (rootPath) await workspace.open(rootPath);
  }, [workspace.open]);

  const handleDeleteWorkspace = useCallback((id: string) => {
    workspace.close(id);
  }, [workspace.close]);

  const deleteSessionRef = useRef(deleteSessionFn);
  deleteSessionRef.current = deleteSessionFn;
  const handleDeleteSession = useCallback((_workspaceId: string, sessionId: string) => {
    deleteSessionRef.current(sessionId);
  }, []);

  const handleOpenSettings = useCallback(() => setSettingsOpen(true), []);

  // Derived values
  const store = useEventStore();

  // Live title from SSE (instant, before API refresh)
  const liveTitle = useSyncExternalStore(
    useCallback(
      (cb: () => void) => {
        if (!activeWorkspaceId || !activeSessionId) return () => {};
        return store.subscribeSession(activeWorkspaceId, activeSessionId, cb);
      },
      [store, activeWorkspaceId, activeSessionId],
    ),
    () => {
      if (!activeWorkspaceId || !activeSessionId) return undefined;
      return store.getSession(activeWorkspaceId, activeSessionId)?.title;
    },
  );

  const sessionTitle = liveTitle ?? activeSession?.title ?? activeSession?.agentId ?? null;

  // Derive context limit from selected model's actual limits
  const contextLimit = useMemo(() => {
    for (const g of models.groups) {
      const found = g.models.find(m => m.id === appConfig.selectedModel);
      if (found) return found.limits.context;
    }
    return undefined;
  }, [models.groups, appConfig.selectedModel]);

  // Merge real-time statuses from EventStore into the API-fetched session list
  const liveSessions = useLiveSessionStatuses(activeWorkspaceId, rawSessions);

  // Refresh session list when active session finishes streaming (picks up new titles)
  const prevStatusRef = useRef<string | undefined>(undefined);
  const refreshSessionsRef = useRef(refreshSessions);
  refreshSessionsRef.current = refreshSessions;
  useEffect(() => {
    if (!activeWorkspaceId || !activeSessionId) return;
    const unsubscribe = store.subscribeSession(activeWorkspaceId, activeSessionId, () => {
      const sess = store.getSession(activeWorkspaceId, activeSessionId);
      if (sess && prevStatusRef.current === 'busy' && sess.status === 'idle') {
        refreshSessionsRef.current();
      }
      prevStatusRef.current = sess?.status;
    });
    return unsubscribe;
  }, [store, activeWorkspaceId, activeSessionId]);

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
                onSelectSession={setActiveSessionId}
                onNewSession={createSession}
                onOpenWorkspace={handleOpenWorkspace}
                onOpenSettings={handleOpenSettings}
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
              agents={agentsHook.agents}
              selectedAgent={agentsHook.selectedAgent}
              onAgentChange={agentsHook.setSelectedAgent}
              model={appConfig.selectedModel}
              effort={appConfig.selectedEffort}
              models={appConfig.enabledModels}
              onModelChange={appConfig.handleModelChange}
              onEffortChange={appConfig.handleEffortChange}
              contextLimit={contextLimit}
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
                    onClick={() => createSession()}
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
            workspacePath={workspace.workspaces.find(w => w.id === activeWorkspaceId)?.rootPath}
            activeAgent={agentsHook.selectedAgent}
            sessionStatus={activeSessionId ? store.getSession(activeWorkspaceId!, activeSessionId)?.status : undefined}
          />
        </div>
      </div>

      {/* Settings modal -- lazy-loaded on first open */}
      {settingsOpen && (
        <ErrorBoundary>
          <Suspense fallback={null}>
            <LazySettingsModal
              isOpen={settingsOpen}
              onClose={() => setSettingsOpen(false)}
              providers={providers}
              models={models}
            />
          </Suspense>
        </ErrorBoundary>
      )}
    </>
  );
}

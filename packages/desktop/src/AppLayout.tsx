/**
 * AppLayout -- main layout component using hooks for state management.
 *
 * Separated from App.tsx so that all hooks can access
 * ApiClientProvider and EventStoreProvider contexts.
 */

import { useState } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { FolderOpen, ChatCompose } from '@openai/apps-sdk-ui/components/Icon';
import { pickDirectory } from './lib/pick-directory';
import { useWorkspace } from './hooks/useWorkspace';
import { useSession } from './hooks/useSession';
import { useModels } from './hooks/useModels';
import { useProviders } from './hooks/useProviders';
import { useAppConfig } from './hooks/useAppConfig';
import { SessionSidebar } from './components/SessionSidebar';
import { ChatPanel } from './components/ChatPanel';
import { TopBar } from './components/TopBar';
import { StatusBar } from './components/StatusBar';
import { SettingsModal } from './components/settings/SettingsModal';
import { ErrorBoundary } from './components/ErrorBoundary';

interface AppLayoutProps {
  connected: boolean;
}

export function AppLayout({ connected }: AppLayoutProps) {
  // State hooks -- all use ApiClient from context internally
  const workspace = useWorkspace();
  const session = useSession(workspace.activeWorkspaceId);
  const models = useModels();
  const providers = useProviders();
  const appConfig = useAppConfig(models);

  // Settings modal
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Handlers
  const handleOpenWorkspace = async () => {
    const rootPath = await pickDirectory();
    if (rootPath) {
      await workspace.open(rootPath);
    }
  };

  // Derived values
  const { activeWorkspaceId } = workspace;
  const { activeSessionId, activeSession } = session;
  const sessionTitle = activeSession?.agentId ?? null;
  const sessionStatus = activeSession?.status ?? null;

  return (
    <>
      <div className="app-shell h-screen flex bg-surface text-default">
        {/* Sidebar */}
        <SessionSidebar
          workspaces={workspace.workspaces}
          activeWorkspaceId={activeWorkspaceId}
          sessions={session.sessions}
          activeSessionId={activeSessionId}
          onSelectWorkspace={workspace.setActiveWorkspaceId}
          onSelectSession={session.setActiveSessionId}
          onNewSession={session.createSession}
          onOpenWorkspace={handleOpenWorkspace}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <TopBar
            sessionTitle={sessionTitle}
            sessionStatus={sessionStatus}
            workspaceId={activeWorkspaceId}
            sessionId={activeSessionId}
          />

          {/* Content */}
          {activeWorkspaceId && activeSessionId ? (
            <ErrorBoundary>
            <ChatPanel
              workspaceId={activeWorkspaceId}
              sessionId={activeSessionId}
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

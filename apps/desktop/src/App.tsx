/**
 * Main App component -- Cursor-like layout with sidebar + main content area.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { EventStore } from './store/event-store';
import { EventStoreProvider } from './store/store-provider';
import { SSEPipe } from './lib/sse-pipe';
import { ApiClient } from './lib/api-client';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { SessionSidebar } from './components/SessionSidebar';
import { ChatPanel } from './components/ChatPanel';
import { TopBar } from './components/TopBar';
import { StatusBar } from './components/StatusBar';
import { SettingsModal } from './components/settings/SettingsModal';
import { useProviders } from './hooks/useProviders';
import { useModels } from './hooks/useModels';
import { FolderOpen, ChatCompose } from '@openai/apps-sdk-ui/components/Icon';
import { pickDirectory } from './lib/pick-directory';

const DEFAULT_SERVER_URL = 'http://127.0.0.1:7878';
const DEFAULT_AUTH_TOKEN = 'dev-token';

export default function App() {
  const [serverUrl] = useState(DEFAULT_SERVER_URL);
  const [authToken] = useState(DEFAULT_AUTH_TOKEN);

  // Core instances
  const store = useMemo(() => new EventStore(), []);
  const pipe = useMemo(() => new SSEPipe(store), [store]);
  const apiClient = useMemo(() => new ApiClient(serverUrl, authToken), [serverUrl, authToken]);

  // State
  const [workspaces, setWorkspaces] = useState<Array<{
    id: string; name: string; rootPath: string; sessionCount: number;
  }>>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Array<{
    id: string; agentId: string; status: string;
  }>>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // Model selection state
  const [selectedModel, setSelectedModel] = useState('gpt-5.3-codex');
  const [selectedEffort, setSelectedEffort] = useState('extra-high');

  // Settings modal state
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Prefetch providers and models at startup (data ready when Settings opens)
  const providers = useProviders(apiClient);
  const models = useModels(apiClient);

  // Connect SSE pipe
  useEffect(() => {
    pipe.connect(serverUrl, authToken);
    setConnected(true);

    return () => {
      pipe.disconnect();
      setConnected(false);
    };
  }, [pipe, serverUrl, authToken]);

  // Load workspaces
  const refreshWorkspaces = useCallback(async () => {
    try {
      const result = await apiClient.listWorkspaces();
      setWorkspaces(result.workspaces);
      if (result.workspaces.length > 0 && !activeWorkspaceId) {
        setActiveWorkspaceId(result.workspaces[0].id);
      }
    } catch {
      // Server not yet available
    }
  }, [apiClient, activeWorkspaceId]);

  useEffect(() => {
    refreshWorkspaces();
  }, [refreshWorkspaces]);

  // Load sessions when workspace changes
  useEffect(() => {
    if (!activeWorkspaceId) {
      setSessions([]);
      return;
    }

    apiClient.listSessions(activeWorkspaceId).then((result) => {
      setSessions(result.sessions);
      if (result.sessions.length > 0 && !activeSessionId) {
        setActiveSessionId(result.sessions[0].id);
      }
    }).catch(() => {
      setSessions([]);
    });
  }, [apiClient, activeWorkspaceId, activeSessionId]);

  const handleOpenWorkspace = async () => {
    const rootPath = await pickDirectory();
    if (rootPath) {
      try {
        const result = await apiClient.openWorkspace(rootPath);
        setActiveWorkspaceId(result.workspace.id);
        await refreshWorkspaces();
      } catch (err) {
        console.error('Failed to open workspace:', err);
      }
    }
  };

  const handleNewSession = async () => {
    if (!activeWorkspaceId) return;
    try {
      const result = await apiClient.createSession(activeWorkspaceId);
      setActiveSessionId(result.session.id);
      const updated = await apiClient.listSessions(activeWorkspaceId);
      setSessions(updated.sessions);
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  };

  // Derive session title from active session
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const sessionTitle = activeSession?.agentId ?? null;
  const sessionStatus = activeSession?.status ?? null;

  return (
    <EventStoreProvider store={store}>
      <div className="app-shell h-screen flex bg-surface text-default">
        {/* Sidebar */}
        <SessionSidebar
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectWorkspace={setActiveWorkspaceId}
          onSelectSession={setActiveSessionId}
          onNewSession={handleNewSession}
          onOpenWorkspace={handleOpenWorkspace}
          onOpenSettings={() => setSettingsOpen(true)}
          apiClient={apiClient}
        />

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <TopBar
            sessionTitle={sessionTitle}
            sessionStatus={sessionStatus}
            workspaceId={activeWorkspaceId}
            sessionId={activeSessionId}
            apiClient={apiClient}
          />

          {/* Content */}
          {activeWorkspaceId && activeSessionId ? (
            <ChatPanel
              workspaceId={activeWorkspaceId}
              sessionId={activeSessionId}
              apiClient={apiClient}
              model={selectedModel}
              effort={selectedEffort}
              onModelChange={setSelectedModel}
              onEffortChange={setSelectedEffort}
            />
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
                    onClick={handleNewSession}
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
            sessionId={activeSessionId}
          />
        </div>
      </div>

      {/* Settings modal -- data pre-loaded at startup */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        providers={providers}
        models={models}
        apiClient={apiClient}
      />
    </EventStoreProvider>
  );
}

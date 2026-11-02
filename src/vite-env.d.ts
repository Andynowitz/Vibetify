/// <reference types="vite/client" />
export {};

interface ImportMetaEnv {
  readonly VITE_SPOTIFY_CLIENT_ID?: string;
  readonly VITE_SPOTIFY_REDIRECT_URI?: string;
  readonly VITE_SPOTIFY_MOCK_MODE?: string;
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  type SpotifyProfile = {
    id: string;
    accountId?: string;
    displayName: string;
    imageUrl?: string;
    spotifyUrl?: string;
  };

  interface Window {
    vibetify: {
      openExternal(url: string): Promise<void>;
      spotify: {
        begin(clientId: string, redirectUri: string): Promise<void>;
        getState(clientId: string): Promise<{ connected: boolean; profile?: SpotifyProfile; error?: string }>;
        disconnect(): Promise<void>;
        diagnostics(): Promise<unknown>;
        resetDiagnostics(): Promise<unknown>;
        mockConfig(): Promise<{ enabled: boolean; status: string; delayMs: number }>;
        setMockConfig(config: { enabled?: boolean; status?: string; delayMs?: number }): Promise<{ enabled: boolean; status: string; delayMs: number }>;
        dashboard(clientId: string): Promise<unknown>;
        playlists(clientId: string, offset?: number): Promise<unknown>;
        library(clientId: string): Promise<unknown>;
        topItems(clientId: string, timeRange: string): Promise<unknown>;
        search(clientId: string, query: string, type: string, offset?: number): Promise<unknown>;
        playlist(clientId: string, id: string): Promise<unknown>;
        track(clientId: string, id: string): Promise<unknown>;
        album(clientId: string, id: string): Promise<unknown>;
        artist(clientId: string, id: string): Promise<unknown>;
        savedStatus(clientId: string, ids: string[]): Promise<boolean[]>;
        updateSaved(clientId: string, ids: string[], saved: boolean): Promise<void>;
        onComplete(callback: (profile: SpotifyProfile) => void): () => void;
        onError(callback: (message: string) => void): () => void;
      };
    };
  }
}

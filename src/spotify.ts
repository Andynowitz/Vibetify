const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined;
export const redirectUri = (import.meta.env.VITE_SPOTIFY_REDIRECT_URI as string | undefined) ?? "http://127.0.0.1:5173/auth/callback";

export function isSpotifyConfigured(): boolean {
  return Boolean(clientId);
}

export async function startSpotifyAuthorization(): Promise<void> {
  if (!clientId) throw new Error("VITE_SPOTIFY_CLIENT_ID is not configured.");
  await window.vibetify.spotify.begin(clientId, redirectUri);
}

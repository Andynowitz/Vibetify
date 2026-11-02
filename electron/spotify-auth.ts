import { app, BrowserWindow, safeStorage, shell } from "electron";
import { createServer, type Server } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createCodeChallenge, createCodeVerifier, createState, isValidLoopbackRedirect, isValidState } from "./oauth";
import { clearSpotifyRequestState, requestSpotify, SpotifyHttpError } from "./spotify-request-manager";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const PROFILE_URL = "https://api.spotify.com/v1/me";
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const scopes = [
  "user-read-private", "user-read-email", "user-read-recently-played", "user-top-read",
  "playlist-read-private", "playlist-read-collaborative", "playlist-modify-public", "playlist-modify-private",
  "user-library-read", "user-library-modify"
].join(" ");

type StoredCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  profile: SpotifyProfile;
};

export type SpotifyProfile = {
  id: string;
  accountId?: string;
  displayName: string;
  imageUrl?: string;
  spotifyUrl?: string;
};

type AuthState = { connected: boolean; profile?: SpotifyProfile; error?: string };
let callbackServer: Server | undefined;
let callbackTimer: NodeJS.Timeout | undefined;
let activeWindow: BrowserWindow | undefined;
let activeState: string | undefined;
let activeVerifier: string | undefined;
let activeClientId: string | undefined;
let activeRedirectUri: string | undefined;
let refreshInFlight: Promise<StoredCredentials> | undefined;
let callbackHandled = false;

const temporaryProfile: SpotifyProfile = { id: "spotify-account", displayName: "Spotify account" };

function profileUnavailableMessage(error: unknown): string {
  if (error instanceof SpotifyHttpError && error.status === 429) {
    return error.reason === "QUOTA_EXCEEDED"
      ? "Spotify API quota exceeded. Your account remains connected; profile data will retry later."
      : "Spotify is temporarily rate limited. Your account remains connected.";
  }
  return error instanceof Error ? error.message : "Spotify profile data is temporarily unavailable.";
}

function credentialsPath(): string {
  return path.join(app.getPath("userData"), "spotify-credentials.bin");
}

async function readCredentials(): Promise<StoredCredentials | undefined> {
  if (!safeStorage.isEncryptionAvailable()) return undefined;
  try {
    const encrypted = await fs.readFile(credentialsPath());
    return JSON.parse(safeStorage.decryptString(encrypted)) as StoredCredentials;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") return undefined;
    throw new Error("Stored Spotify credentials could not be read.");
  }
}

async function writeCredentials(credentials: StoredCredentials): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure credential storage is unavailable.");
  await fs.mkdir(path.dirname(credentialsPath()), { recursive: true });
  await fs.writeFile(credentialsPath(), safeStorage.encryptString(JSON.stringify(credentials)));
}

async function clearCredentials(): Promise<void> {
  try {
    await fs.unlink(credentialsPath());
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") throw new Error("Spotify credentials could not be removed.");
  }
}

function parseProfile(data: Record<string, unknown>): SpotifyProfile {
  const images = Array.isArray(data.images) ? data.images : [];
  const image = images.find((entry): entry is { url: string } =>
    typeof entry === "object" && entry !== null && typeof (entry as { url?: unknown }).url === "string");
  return {
    id: typeof data.id === "string" ? data.id : "",
    accountId: typeof data.account_id === "string" ? data.account_id : undefined,
    displayName: typeof data.display_name === "string" && data.display_name ? data.display_name : "Spotify user",
    imageUrl: image?.url,
    spotifyUrl: typeof (data.external_urls as { spotify?: unknown } | undefined)?.spotify === "string"
      ? (data.external_urls as { spotify: string }).spotify : undefined
  };
}

async function exchangeCode(code: string): Promise<StoredCredentials> {
  if (!activeClientId || !activeVerifier || !activeRedirectUri) throw new Error("Spotify authorization session is missing.");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: activeClientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: activeRedirectUri,
      code_verifier: activeVerifier
    })
  });
  if (!response.ok) throw new Error(`Spotify token exchange failed (${response.status}).`);
  const token = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!token.access_token || !token.refresh_token || typeof token.expires_in !== "number") {
    throw new Error("Spotify returned an incomplete token response.");
  }
  return { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000, profile: temporaryProfile };
}

async function refreshCredentials(credentials: StoredCredentials): Promise<StoredCredentials> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: activeClientId ?? "", grant_type: "refresh_token", refresh_token: credentials.refreshToken })
  });
  if (!response.ok) {
    let invalid = false;
    try { invalid = (await response.json() as { error?: string }).error === "invalid_grant"; } catch { /* optional error body */ }
    throw new Error(invalid ? "SPOTIFY_INVALID_REFRESH_TOKEN" : `Spotify token refresh failed (${response.status}).`);
  }
  const token = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!token.access_token || typeof token.expires_in !== "number") throw new Error("Spotify returned an invalid refresh response.");
  const refreshed = {
    ...credentials,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? credentials.refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000
  };
  await writeCredentials(refreshed);
  return refreshed;
}

function refreshCredentialsOnce(credentials: StoredCredentials): Promise<StoredCredentials> {
  if (!refreshInFlight) {
    refreshInFlight = refreshCredentials(credentials).finally(() => { refreshInFlight = undefined; });
  }
  return refreshInFlight;
}

export async function getSpotifyAccessToken(clientId: string): Promise<string> {
  activeClientId = clientId;
  let credentials = await readCredentials();
  if (!credentials) throw new Error("Spotify is not connected.");
  if (credentials.expiresAt <= Date.now() + 60_000) credentials = await refreshCredentialsOnce(credentials);
  return credentials.accessToken;
}

export async function refreshSpotifyAccessToken(clientId: string): Promise<string> {
  activeClientId = clientId;
  const credentials = await readCredentials();
  if (!credentials) throw new Error("Spotify is not connected.");
  return (await refreshCredentialsOnce(credentials)).accessToken;
}

async function fetchProfileManaged(accessToken: string): Promise<SpotifyProfile> {
  const profile = await requestSpotify<SpotifyProfile>("GET:spotify-profile", async () =>
    fetch(PROFILE_URL, { headers: { Authorization: `Bearer ${accessToken}` } }), {
    cacheTtlMs: 300_000,
    parse: async response => parseProfile(await response.json() as Record<string, unknown>)
  });
  if (!profile.id) throw new Error("Spotify returned a profile without a user ID.");
  return profile;
}

async function enrichStoredProfile(accessToken: string): Promise<SpotifyProfile> {
  const profile = await fetchProfileManaged(accessToken);
  const credentials = await readCredentials();
  if (credentials && credentials.accessToken === accessToken) {
    credentials.profile = profile;
    await writeCredentials(credentials);
  }
  return profile;
}

async function fetchProfile(accessToken: string): Promise<SpotifyProfile> {
  const response = await fetch(PROFILE_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Spotify profile request failed (${response.status}).`);
  const profile = parseProfile(await response.json() as Record<string, unknown>);
  if (!profile.id) throw new Error("Spotify returned a profile without a user ID.");
  return profile;
}

function closeCallbackServer(): void {
  callbackServer?.close();
  callbackServer = undefined;
  if (callbackTimer) clearTimeout(callbackTimer);
  callbackTimer = undefined;
  activeState = undefined;
  activeVerifier = undefined;
  activeClientId = undefined;
  activeRedirectUri = undefined;
  callbackHandled = false;
}

function callbackPage(message: string): string {
  return `<html><body style="font-family: sans-serif; background:#0e0b13;color:#fff;padding:40px"><h2>${message}</h2><p>You can close this tab and return to Vibetify.</p></body></html>`;
}

export async function beginSpotifyAuthorization(window: BrowserWindow, clientId: string, redirectUri: string): Promise<void> {
  if (!clientId.trim()) throw new Error("Spotify Client ID is not configured.");
  if (!isValidLoopbackRedirect(redirectUri)) throw new Error("Spotify redirect URI must be a loopback /auth/callback URI.");
  closeCallbackServer();
  activeWindow = window;
  activeClientId = clientId;
  activeRedirectUri = redirectUri;
  callbackHandled = false;
  activeState = createState();
  activeVerifier = createCodeVerifier();
  const callbackUrl = new URL(redirectUri);
  callbackServer = createServer((request, response) => {
    void (async () => {
      if (callbackHandled) {
        response.writeHead(409, { "Content-Type": "text/html" }).end(callbackPage("This Spotify authorization was already processed."));
        return;
      }
      const requestUrl = new URL(request.url ?? "/", `${callbackUrl.protocol}//${callbackUrl.host}`);
      if (requestUrl.pathname !== callbackUrl.pathname) {
        response.writeHead(404).end();
        return;
      }
      const error = requestUrl.searchParams.get("error");
      const returnedState = requestUrl.searchParams.get("state");
      const code = requestUrl.searchParams.get("code");
      if (error) {
        response.writeHead(400, { "Content-Type": "text/html" }).end(callbackPage("Spotify authorization was denied."));
        closeCallbackServer();
        activeWindow?.webContents.send("spotify:auth-error", "Spotify authorization was denied.");
        return;
      }
      if (!isValidState(activeState, returnedState)) {
        response.writeHead(400, { "Content-Type": "text/html" }).end(callbackPage("The Spotify authorization state was invalid."));
        closeCallbackServer();
        activeWindow?.webContents.send("spotify:auth-error", "The Spotify authorization state was invalid.");
        return;
      }
      if (!code) throw new Error("Spotify did not return an authorization code.");
      callbackHandled = true;
      const credentials = await exchangeCode(code);
      await writeCredentials(credentials);
      response.writeHead(200, { "Content-Type": "text/html" }).end(callbackPage("Spotify is connected."));
      closeCallbackServer();
      activeWindow?.webContents.send("spotify:auth-complete", credentials.profile);
      void enrichStoredProfile(credentials.accessToken)
        .then(profile => activeWindow?.webContents.send("spotify:auth-complete", profile))
        .catch(error => activeWindow?.webContents.send("spotify:auth-error", profileUnavailableMessage(error)));
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Spotify authorization failed.";
      response.writeHead(500, { "Content-Type": "text/html" }).end(callbackPage("Spotify authorization failed."));
      closeCallbackServer();
      activeWindow?.webContents.send("spotify:auth-error", message);
    });
  });
  await new Promise<void>((resolve, reject) => {
    callbackServer?.once("error", reject);
    callbackServer?.listen(Number(callbackUrl.port), callbackUrl.hostname, resolve);
  });
  callbackTimer = setTimeout(() => {
    closeCallbackServer();
    activeWindow?.webContents.send("spotify:auth-error", "Spotify authorization timed out.");
  }, CALLBACK_TIMEOUT_MS);
  const authorizationUrl = new URL("https://accounts.spotify.com/authorize");
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: createCodeChallenge(activeVerifier),
    state: activeState,
    scope: scopes
  }).toString();
  await shell.openExternal(authorizationUrl.toString());
}

export async function getAuthState(clientId?: string): Promise<AuthState> {
  if (clientId?.trim()) activeClientId = clientId;
  let credentials = await readCredentials();
  if (!credentials) return { connected: false };
  try {
    if (credentials.expiresAt <= Date.now() + 60_000) credentials = await refreshCredentialsOnce(credentials);
    let profile: SpotifyProfile;
    try {
      profile = await fetchProfileManaged(credentials.accessToken);
    } catch (error) {
      if (error instanceof SpotifyHttpError && error.status === 401) {
        credentials = await refreshCredentialsOnce(credentials);
        profile = await fetchProfileManaged(credentials.accessToken);
      } else {
        return { connected: true, profile: credentials.profile, error: profileUnavailableMessage(error) };
      }
    }
    if (JSON.stringify(profile) !== JSON.stringify(credentials.profile)) {
      credentials.profile = profile;
      await writeCredentials(credentials);
    }
    return { connected: true, profile };
  } catch (error) {
    if (error instanceof Error && error.message === "SPOTIFY_INVALID_REFRESH_TOKEN") {
      await clearCredentials();
      return { connected: false, error: "Spotify authorization is no longer valid. Please reconnect." };
    }
    return { connected: true, profile: credentials.profile, error: profileUnavailableMessage(error) };
  }
}

export async function disconnectSpotify(): Promise<void> {
  closeCallbackServer();
  clearSpotifyRequestState();
  await clearCredentials();
}

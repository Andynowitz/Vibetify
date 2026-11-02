export type Section = "dashboard" | "assistant" | "playlists" | "discover" | "library" | "stats" | "settings";

export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  color: string;
};

export type Playlist = {
  id: string;
  name: string;
  description: string;
  trackCount: number;
  color: string;
  icon: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  tracks?: Track[];
};

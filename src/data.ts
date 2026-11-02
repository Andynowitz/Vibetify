import type { Playlist, Track } from "./types";

export const tracks: Track[] = [
  { id: "saturn", title: "Saturn", artist: "Nina Cobham", album: "Little Waves", duration: "3:42", color: "#7651c9" },
  { id: "places", title: "Places to Be", artist: "Fred again..", album: "ten days", duration: "3:45", color: "#d67f36" },
  { id: "romantic", title: "Everything Is Romantic", artist: "Charli xcx", album: "BRAT", duration: "3:23", color: "#26a76d" },
  { id: "glow", title: "Glow", artist: "Barry Can't Swim", album: "When Will We Land?", duration: "4:02", color: "#2b84bd" }
];

export const playlists: Playlist[] = [
  { id: "night-drive", name: "Night Drive", description: "Neon-lit roads and open windows.", trackCount: 42, color: "#41317a", icon: "◒" },
  { id: "main-character", name: "Main Character", description: "The soundtrack to your best days.", trackCount: 28, color: "#8f4b65", icon: "✦" },
  { id: "deep-focus", name: "Deep Focus", description: "A clear head and a little momentum.", trackCount: 63, color: "#226d74", icon: "◌" },
  { id: "sunday-reset", name: "Sunday Reset", description: "Slow mornings, clean spaces.", trackCount: 19, color: "#a86e26", icon: "☼" }
];

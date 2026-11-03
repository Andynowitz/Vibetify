import { useCallback, useEffect, useRef, useState } from "react";
import { sharedSpotifyStore, type LoadOptions, type ResourceFetcher, type ResourceState } from "./spotify-store";

export type SpotifyResource<T> = ResourceState<T> & { refresh: () => void };

export function useSpotifyResource<T>(key: string, fetcher: ResourceFetcher<T>, enabled: boolean, options?: LoadOptions): SpotifyResource<T> {
  const [snapshot, setSnapshot] = useState<ResourceState<T>>(() => sharedSpotifyStore.get<T>(key));
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const unsubscribe = sharedSpotifyStore.subscribe(key, () => setSnapshot(sharedSpotifyStore.get<T>(key)));
    setSnapshot(sharedSpotifyStore.get<T>(key));
    return unsubscribe;
  }, [key]);

  useEffect(() => {
    if (!enabled) return;
    void sharedSpotifyStore.load(key, current => fetcherRef.current(current), optionsRef.current).catch(() => undefined);
  }, [key, enabled]);

  const refresh = useCallback(() => {
    void sharedSpotifyStore.refresh(key, current => fetcherRef.current(current)).catch(() => undefined);
  }, [key]);

  return { ...snapshot, refresh };
}

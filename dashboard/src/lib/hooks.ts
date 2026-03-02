"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = []
): { data: T | null; error: string | null; loading: boolean; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const hasDataRef = useRef(false);

  const refetch = useCallback(() => {
    // Only show loading spinner on initial fetch, not background refreshes
    if (!hasDataRef.current) {
      setLoading(true);
    }
    setError(null);
    fetcher()
      .then((d) => {
        if (mountedRef.current) {
          setData(d);
          hasDataRef.current = true;
        }
      })
      .catch((e) => {
        if (mountedRef.current) setError(e instanceof Error ? e.message : "Unknown error");
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mountedRef.current = true;
    hasDataRef.current = false;
    setLoading(true);
    refetch();
    return () => {
      mountedRef.current = false;
    };
  }, [refetch]);

  return { data, error, loading, refetch };
}

export function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => savedCallback.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

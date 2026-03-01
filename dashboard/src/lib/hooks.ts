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

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    fetcher()
      .then((d) => {
        if (mountedRef.current) setData(d);
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

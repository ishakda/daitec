"use client";
import useSWR from "swr";

/** Client-side API helpers: typed fetch with structured error surfaces. */

export class ClientApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit & { json?: unknown }
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api/v1${path}`, {
    ...rest,
    headers: {
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...rest.headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new ClientApiError(401, "UNAUTHORIZED", "Session expired");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ClientApiError(res.status, err.code ?? "INTERNAL", err.message ?? "Request failed", err.details);
  }
  return data as T;
}

const fetcher = (path: string) => apiFetch(path);

export function useApi<T = unknown>(path: string | null, opts?: { refreshInterval?: number }) {
  const { data, error, isLoading, mutate } = useSWR<T>(path, fetcher as (p: string) => Promise<T>, {
    revalidateOnFocus: false,
    keepPreviousData: true,
    ...opts,
  });
  return { data, error: error as ClientApiError | undefined, isLoading, mutate };
}

export type Me = {
  user: { id: string; email: string; fullName: string };
  companies: Array<{ id: string; name: string; currency: string; role: string; isOwner: boolean; suspended?: boolean }>;
  activeCompanyId: string | null;
  permissions: string[];
  isPlatformAdmin?: boolean;
};

export function useMe() {
  const r = useApi<Me>("/me");
  const can = (perm: string) =>
    r.data ? r.data.permissions.includes("*") || r.data.permissions.includes(perm) : false;
  return { ...r, can };
}

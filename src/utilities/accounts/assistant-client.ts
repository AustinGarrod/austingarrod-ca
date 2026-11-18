import type { AccountSession } from "../../../packages/accounts/client";

export interface AssistantConnection {
  id: string;
  utility: string;
  client: string;
  canWrite: boolean;
  createdAt: string;
}

export async function assistantRequest<T>(
  endpoint: "connections" | "oauth/consent", session: AccountSession, body?: unknown,
): Promise<T> {
  if (!session.user) throw new Error("Sign in to manage assistant access.");
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Account-ID": session.user.id,
  };
  if (body !== undefined) {
    headers["X-CSRF-Token"] = session.csrfToken;
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch("/api/v1/mcp/" + endpoint, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin", cache: "no-store", headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message ?? "Assistant access could not be updated.");
  return data as T;
}

export function permittedAssistantCallback(value: string): boolean {
  const uri = new URL(value);
  if (uri.username || uri.password || uri.hash) return false;
  if (uri.origin === "https://chatgpt.com") return uri.pathname === "/connector_platform_oauth_redirect";
  if (uri.origin === "https://claude.ai") return uri.pathname === "/api/mcp/auth_callback";
  return uri.protocol === "http:" && (uri.hostname === "localhost" || uri.hostname === "127.0.0.1")
    && uri.pathname === "/callback";
}

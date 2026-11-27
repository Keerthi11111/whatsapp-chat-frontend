"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

export const TOKEN_KEY = "chat_token";
export const USER_KEY = "chat_user";

// Re-check when the token changes in another tab (e.g. logout there).
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

const getToken = () => localStorage.getItem(TOKEN_KEY);
// On the server we can't know yet, so "undefined" means "still checking".
const getServerToken = () => undefined;

type AuthGuardProps = {
  /**
   * "protected": only for logged-in users, otherwise go to /login.
   * "guest": only for logged-out users (login/register), otherwise go to /.
   */
  mode: "protected" | "guest";
  children: React.ReactNode;
};

export default function AuthGuard({ mode, children }: AuthGuardProps) {
  const router = useRouter();
  const token = useSyncExternalStore(subscribe, getToken, getServerToken);

  const checking = token === undefined;
  const allowed = mode === "protected" ? !!token : !token;

  useEffect(() => {
    if (checking || allowed) return;
    router.replace(mode === "protected" ? "/login" : "/");
  }, [checking, allowed, mode, router]);

  if (checking || !allowed) {
    return (
      <div className="min-h-screen w-full bg-slate-950 flex items-center justify-center">
        <LoaderCircle className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  return <>{children}</>;
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getMyProfile, logoutUser, type User } from "@/services/auth";
import { socket } from "@/services/socket";
import { TOKEN_KEY, USER_KEY, logout as clearSession } from "./AuthGuard";

function readStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

/**
 * For pages inside <AuthGuard mode="protected">.
 * Shows the cached user instantly, then refreshes it from GET /api/users/me.
 * If the server says the token is no longer valid (expired, or logged out
 * elsewhere), the user is sent back to the login page.
 */
export function useCurrentUser() {
  const router = useRouter();
  const [token] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [user, setUserState] = useState<User | null>(readStoredUser);

  const setUser = useCallback((next: User) => {
    localStorage.setItem(USER_KEY, JSON.stringify(next));
    setUserState(next);
  }, []);

  const endSession = useCallback(() => {
    clearSession();
    socket.disconnect();
    router.replace("/login");
  }, [router]);

  const logout = useCallback(async () => {
    // Best effort: still log out locally if the server can't be reached.
    await logoutUser(token).catch(() => {});
    endSession();
  }, [token, endSession]);

  useEffect(() => {
    getMyProfile(token)
      .then(setUser)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) endSession();
      });
  }, [token, setUser, endSession]);

  return { token, user, setUser, logout, endSession };
}

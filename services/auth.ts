import type { ChatMessage, SyncPage } from "@/components/chat/types";

export const SERVER_URL = "http://localhost:5000";
const API_URL = `${SERVER_URL}/api`;

export interface User {
  id: string;
  name: string;
  username: string;
  phone: string | null;
  email: string;
  profileImage: string | null;
  createdAt?: string;
}

/** Error that keeps the HTTP status, so callers can spot 401 (logged out). */
export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}, fallbackError = "Request failed"): Promise<T> {
  const { token, headers, ...rest } = init;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      }
    });
  } catch {
    throw new ApiError("Cannot reach the server. Is the backend running?", 0);
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message: string = result.message || fallbackError;
    const internal = internalErrorMessage(message);
    if (internal) {
      // Keep the real error for developers, show the user something readable.
      console.error(`[${response.status}] ${path}:`, message);
      // 503 (not the server's 401) so pages don't treat it as "logged out".
      throw new ApiError(internal, 503);
    }
    throw new ApiError(message, response.status);
  }

  return result as T;
}

/**
 * Some backend routes forward raw Prisma / database errors (e.g. "Invalid
 * `prisma.user.findUnique()` invocation ... Can't reach database server").
 * Returns a user-friendly text for those, or null for normal messages.
 */
function internalErrorMessage(message: string): string | null {
  const isInternal = /prisma|invocation|database server|P\d{4}\b|ECONNREFUSED|ETIMEDOUT|at .+\.(ts|js):\d+/i.test(message);
  if (!isInternal) return null;
  if (/can't reach database|cannot reach database|database server|P100[12]\b|P1017\b|ECONNREFUSED|ETIMEDOUT|timed out/i.test(message)) {
    return "Can't connect to the database right now. Please try again in a moment.";
  }
  return "Something went wrong on the server. Please try again.";
}

const json = (body: unknown) => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

export function registerUser(data: { name: string; username: string; phone?: string; email: string; password: string }) {
  return request<{ user: User }>("/auth/register", { method: "POST", ...json(data) }, "Registration failed");
}

export function loginUser(data: { email: string; password: string }) {
  return request<{ token: string; user: User }>("/auth/login", { method: "POST", ...json(data) }, "Login failed");
}

/** Invalidates the token on the server (all devices using older tokens are logged out). */
export async function logoutUser(token: string) {
  await request("/auth/logout", { method: "POST", token }, "Logout failed");
}

export async function getMyProfile(token: string) {
  const result = await request<{ user: User }>("/users/me", { token }, "Profile request failed");
  return result.user;
}

/** phone: null clears it. */
export async function updateProfile(token: string, data: { name?: string; username?: string; phone?: string | null }) {
  const result = await request<{ user: User }>("/users/me", { method: "PATCH", token, ...json(data) }, "Could not update profile");
  return result.user;
}

export async function uploadProfilePhoto(token: string, file: File) {
  const form = new FormData();
  form.append("photo", file);
  const result = await request<{ user: User }>("/users/me/photo", { method: "POST", token, body: form }, "Could not upload photo");
  return result.user;
}

export async function removeProfilePhoto(token: string) {
  const result = await request<{ user: User }>("/users/me/photo", { method: "DELETE", token }, "Could not remove photo");
  return result.user;
}

/**
 * Another person, as shown in chats and contact info. phone/email may be
 * missing ("" / null) when the server doesn't share them with us.
 */
export interface Contact {
  id: string;
  name: string;
  username: string;
  phone: string | null;
  email: string;
  profileImage: string | null;
  /** Only for people who share a chat with me (otherwise missing). */
  isOnline?: boolean;
  /** When their last device disconnected; null if never seen since the feature launched. */
  lastSeenAt?: string | null;
}

/** A search hit. phone is only present when you searched by that number. */
export interface SearchResult {
  id: string;
  name: string;
  username: string;
  profileImage: string | null;
  phone?: string | null;
}

/** Same rule the server uses: digits, spaces, dashes, () or a leading +, with 7+ digits. */
export function looksLikePhone(q: string) {
  return /^\+?[\d\s()-]+$/.test(q.trim()) && (q.match(/\d/g)?.length ?? 0) >= 7;
}

/** Search by username (prefix, "@" optional) or exact phone number. */
export async function searchUsers(token: string, q: string) {
  const result = await request<{ users: SearchResult[] }>(
    `/users/search?q=${encodeURIComponent(q.trim())}`,
    { token },
    "Search failed"
  );
  return result.users;
}

export async function getUserById(token: string, userId: string) {
  const result = await request<{ user: Contact }>(`/users/${encodeURIComponent(userId)}`, { token }, "User not found");
  return result.user;
}

/** A private chat saved on the server. otherUser is the person you're talking to. */
export interface Conversation {
  id: string;
  otherUser: Contact;
  /** Newest message, for the chat list preview (null until someone writes). */
  lastMessage: ChatMessage | null;
  /** Messages sent to me here that I haven't read yet. */
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

/** My chat list from the database, newest first. */
export async function getConversations(token: string) {
  const result = await request<{ conversations: Conversation[] }>("/conversations", { token }, "Could not load chats");
  return result.conversations;
}

/** Opens the private chat with a user, creating it the first time (same chat from both sides). */
export async function startConversation(token: string, userId: string) {
  const result = await request<{ conversation: Conversation }>(
    "/conversations",
    { method: "POST", token, ...json({ userId }) },
    "Could not start chat"
  );
  return result.conversation;
}

/**
 * A page of a chat's history, oldest -> newest.
 *   no cursor: the newest messages (opening a chat)
 *   before:    older than that message id (scrolling up)
 *   after:     newer than that message id (catching up after reconnecting)
 */
export async function getMessages(
  token: string,
  conversationId: string,
  cursor: { before?: string; after?: string } = {},
  limit = 30
) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor.before) params.set("before", cursor.before);
  if (cursor.after) params.set("after", cursor.after);
  return request<{ messages: ChatMessage[]; hasMore: boolean }>(
    `/conversations/${encodeURIComponent(conversationId)}/messages?${params}`,
    { token },
    "Could not load messages"
  );
}

/**
 * Sends over HTTP (used when the socket is offline). The server still pushes new_message to everyone.
 * Resending with the same clientMessageId returns the already-saved message instead of a copy.
 */
export async function postMessage(token: string, conversationId: string, content: string, clientMessageId: string) {
  const result = await request<{ message: ChatMessage }>(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    { method: "POST", token, ...json({ content, clientMessageId }) },
    "Could not send message"
  );
  return result.message;
}

/**
 * HTTP fallback for the "messages_delivered" / "messages_read" socket events:
 * marks messages sent to me, up to messageId (or all), as delivered or read.
 */
export async function markConversation(
  token: string,
  conversationId: string,
  status: "delivered" | "read",
  messageId?: string
) {
  await request(
    `/conversations/${encodeURIComponent(conversationId)}/${status}`,
    { method: "POST", token, ...json(messageId ? { messageId } : {}) },
    `Could not mark messages as ${status}`
  );
}

/**
 * Offline catch-up across all my chats. Call with the syncedAt from the
 * previous sync; when hasMore is true, call again with the same `since` and
 * cursor = id of the last message received.
 */
export function syncMessages(token: string, since: string, cursor?: string, limit = 100) {
  const params = new URLSearchParams({ since, limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return request<SyncPage>(`/messages/sync?${params}`, { token }, "Could not sync messages");
}

/** Hides messages only for me. One id uses the single route, several use the bulk route. */
export async function deleteMessagesForMe(token: string, messageIds: string[]) {
  if (messageIds.length === 1) {
    await request(`/messages/${encodeURIComponent(messageIds[0])}/me`, { method: "DELETE", token }, "Could not delete message");
  } else {
    await request("/messages/delete-multiple/me", { method: "POST", token, ...json({ messageIds }) }, "Could not delete messages");
  }
}

/** Deletes my own messages for every member. Returns the updated ("deleted") messages. */
export async function deleteMessagesForEveryone(token: string, messageIds: string[]): Promise<ChatMessage[]> {
  if (messageIds.length === 1) {
    const result = await request<{ message: ChatMessage }>(
      `/messages/${encodeURIComponent(messageIds[0])}/everyone`,
      { method: "DELETE", token },
      "Could not delete message"
    );
    return [result.message];
  }
  const result = await request<{ messages: ChatMessage[] }>(
    "/messages/delete-multiple/everyone",
    { method: "POST", token, ...json({ messageIds }) },
    "Could not delete messages"
  );
  return result.messages;
}

/** Turns a stored profileImage ("/uploads/x.jpg" or a full URL) into an <img> src. */
export function photoUrl(profileImage: string | null | undefined) {
  if (!profileImage) return null;
  return profileImage.startsWith("/") ? `${SERVER_URL}${profileImage}` : profileImage;
}

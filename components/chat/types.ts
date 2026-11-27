/** A message saved in PostgreSQL (REST history, socket "new_message", send ack). */
export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string; // permanent user ID
  content: string; // "" once deleted for everyone
  createdAt: string;
  isDeletedForEveryone: boolean;
  deletedAt: string | null;
  /** Random id this app made when sending; a retry reuses it so the server never saves a copy. */
  clientMessageId: string | null;
  /** Ticks: sent ✓, delivered ✓✓, read blue ✓✓ (for every recipient). */
  status: MessageStatus;
  sentAt: string;
  deliveredAt: string | null; // when the last recipient got it
  readAt: string | null; // when the last recipient read it
  sender: { id: string; name: string; username: string; profileImage: string | null };
}

export type MessageStatus = "sent" | "delivered" | "read";

/**
 * A message on screen: saved ones, plus ones not on the server yet.
 * sendState is client-only: "sending" shows the clock, "failed" offers a retry.
 */
export type DisplayMessage = ChatMessage & { sendState?: "sending" | "failed" };

/** Socket "message_status": userId got (delivered) or read these messages. */
export interface MessageStatusEvent {
  conversationId: string;
  userId: string;
  status: "delivered" | "read";
  messageIds: string[];
  at: string;
}

const STATUS_RANK: Record<MessageStatus, number> = { sent: 0, delivered: 1, read: 2 };

/**
 * Applies a tick change, never moving backwards (a late "delivered" must not
 * undo "read"). Returns the same object when nothing changes.
 */
export function withStatus<T extends ChatMessage>(m: T, status: MessageStatus, deliveredAt: string | null, readAt: string | null): T {
  if (STATUS_RANK[status] <= STATUS_RANK[m.status ?? "sent"]) return m;
  return {
    ...m,
    status,
    deliveredAt: m.deliveredAt ?? deliveredAt ?? readAt,
    readAt: status === "read" ? m.readAt ?? readAt : m.readAt,
  };
}

/** Socket "message_deleted_for_me": I hid these (on this or another device). */
export interface DeletedForMeEvent {
  messageIds: string[];
  conversationId?: string;
  conversationIds?: string[];
}

/** Socket "message_deleted_for_everyone": the sender removed these for all members. */
export interface DeletedForEveryoneEvent {
  messages: ChatMessage[];
}

/** GET /api/messages/sync: what changed while we were offline, across all chats. */
export interface SyncPage {
  messages: ChatMessage[];
  deletedForEveryone: ChatMessage[];
  deletedForMe: { messageId: string; conversationId: string }[];
  /** Ticks that changed on my older messages while I was away. */
  statusUpdates: {
    messageId: string;
    conversationId: string;
    status: MessageStatus;
    deliveredAt: string | null;
    readAt: string | null;
  }[];
  hasMore: boolean;
  syncedAt: string;
}

/** Text shown in place of a message deleted for everyone (WhatsApp wording). */
export const deletedText = (mine: boolean) => (mine ? "You deleted this message" : "This message was deleted");

/** Socket event "profile_updated": someone changed their name, username or photo (never includes phone). */
export interface ProfileUpdate {
  id: string;
  name: string;
  username: string;
  profileImage: string | null;
}

/** Socket "presence_update" and the "get_presence" ack: online / last seen of a contact. */
export interface Presence {
  userId: string;
  isOnline: boolean;
  lastSeenAt: string | null;
}

/** Socket "typing": someone in a chat started or stopped typing. */
export interface TypingEvent {
  conversationId: string;
  userId: string;
  isTyping: boolean;
}

/** WhatsApp wording: "last seen today at 10:42", "last seen yesterday at 09:12", "last seen 19/11/2026 at 18:40". */
export function formatLastSeen(iso: string) {
  const days = daysAgo(iso);
  const day = days <= 0 ? "today" : days === 1 ? "yesterday" : new Date(iso).toLocaleDateString();
  return `last seen ${day} at ${formatTime(iso)}`;
}

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function daysAgo(iso: string) {
  return Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86_400_000);
}

/** Chat list time, like WhatsApp: "14:05", "Yesterday", "Monday", "12/11/2026". */
export function formatListTime(iso: string) {
  const days = daysAgo(iso);
  if (days <= 0) return formatTime(iso);
  if (days === 1) return "Yesterday";
  if (days < 7) return new Date(iso).toLocaleDateString([], { weekday: "long" });
  return new Date(iso).toLocaleDateString();
}

/** Date separator inside a chat: "Today", "Yesterday", "19 November 2026". */
export function formatDayLabel(iso: string) {
  const days = daysAgo(iso);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(iso).toLocaleDateString([], { dateStyle: "long" });
}

/**
 * Merge two message lists, ordered oldest -> newest, with no duplicates:
 *  - same id: the later copy wins (e.g. now deleted), but ticks never go backwards
 *  - a pending copy is dropped once the saved message with its clientMessageId is in
 */
export function mergeMessages(a: DisplayMessage[], b: DisplayMessage[]) {
  const byId = new Map<string, DisplayMessage>();
  for (const m of [...a, ...b]) {
    const old = byId.get(m.id);
    byId.set(m.id, old && !m.sendState ? withStatus(m, old.status, old.deliveredAt, old.readAt) : m);
  }
  const savedClientIds = new Set(
    [...byId.values()].filter((m) => !m.sendState && m.clientMessageId).map((m) => m.clientMessageId)
  );
  for (const [id, m] of byId) {
    if (m.sendState && m.clientMessageId && savedClientIds.has(m.clientMessageId)) byId.delete(id);
  }
  return [...byId.values()].sort(
    (x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id)
  );
}

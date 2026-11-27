"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Ban, LoaderCircle, LogOut, MessageCircle, MessageSquarePlus, Search, WifiOff, X } from "lucide-react";
import { connectSocket, socket } from "@/services/socket";
import {
  ApiError,
  deleteMessagesForEveryone,
  deleteMessagesForMe,
  getConversations,
  getMessages,
  markConversation,
  postMessage,
  startConversation,
  syncMessages,
  type Contact,
  type Conversation,
  type SearchResult,
  type User,
} from "@/services/auth";
import { useCurrentUser } from "@/components/auth/useCurrentUser";
import Avatar from "@/components/Avatar";
import ConversationPanel, { type Thread } from "./ConversationPanel";
import ContactInfo from "./ContactInfo";
import NewChatDialog from "./NewChatDialog";
import type { DeleteMode } from "./DeleteMessagesDialog";
import MessageTicks from "./MessageTicks";
import {
  deletedText,
  formatListTime,
  mergeMessages,
  withStatus,
  type ChatMessage,
  type DeletedForEveryoneEvent,
  type DeletedForMeEvent,
  type DisplayMessage,
  type MessageStatus,
  type MessageStatusEvent,
  type Presence,
  type ProfileUpdate,
  type TypingEvent,
} from "./types";

/** A tick change for some messages (from the socket or a sync page). */
type StatusChange = {
  messageIds: string[];
  status: MessageStatus;
  deliveredAt: string | null;
  readAt: string | null;
};

export default function ChatWindow() {
  const session = useCurrentUser();

  if (!session.user) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-[#f0f2f5]">
        <LoaderCircle className="h-8 w-8 animate-spin text-[#00a884]" />
      </div>
    );
  }

  return <ChatApp {...session} me={session.user} />;
}

/** One row of the chat list. id is the conversation ID (from PostgreSQL). */
type Chat = {
  id: string;
  contact: Contact;
  lastMessage: ChatMessage | null;
  updatedAt: string;
};

const toChat = (c: Conversation): Chat => ({
  id: c.id,
  contact: c.otherUser,
  lastMessage: c.lastMessage ?? null,
  updatedAt: c.updatedAt,
});

/** Latest activity: the newest message, or when the chat was created. */
const activity = (chat: Chat) => chat.lastMessage?.createdAt ?? chat.updatedAt;
const sortChats = (list: Chat[]) => [...list].sort((a, b) => activity(b).localeCompare(activity(a)));

const EMPTY_THREAD: Thread = { messages: [], loaded: false, loading: false, hasMore: false, loadingOlder: false, error: "" };
const isSaved = (m: DisplayMessage) => !m.sendState;
const SEND_TIMEOUT_MS = 10_000;
/** The server accepts at most 100 ids per bulk delete. */
const DELETE_BATCH = 100;
/** Hide "typing..." if no update came for this long (server expires it after 6s). */
const TYPING_EXPIRE_MS = 8_000;
/** First sync starts a bit before the page opened, to cover client/server clock drift. */
const FIRST_SYNC_MARGIN_MS = 30_000;

type ChatAppProps = ReturnType<typeof useCurrentUser> & { me: User };

function ChatApp({ me, token, setUser, logout, endSession }: ChatAppProps) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [chatsError, setChatsError] = useState("");
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState("");
  // Read receipts are only sent while the tab is actually on screen.
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  // Chats where the other person is typing right now.
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  // Safety net: clear "typing..." if the server's "stopped" never arrives.
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Socket handlers are registered once, so they read the latest state through refs.
  const activeIdRef = useRef(activeId);
  const meRef = useRef(me);
  const chatsRef = useRef(chats);
  const threadsRef = useRef(threads);
  const visibleRef = useRef(visible);
  useEffect(() => {
    activeIdRef.current = activeId;
    meRef.current = me;
    chatsRef.current = chats;
    threadsRef.current = threads;
    visibleRef.current = visible;
  });

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Where the next GET /api/messages/sync starts. Until the first sync answers,
  // it's "a little before this page loaded".
  const syncedAt = useRef<string | null>(null);
  const [openedAt] = useState(() => new Date(Date.now() - FIRST_SYNC_MARGIN_MS).toISOString());
  const syncing = useRef(false);

  const updateThread = useCallback((id: string, change: (t: Thread) => Partial<Thread>) => {
    setThreads((all) => {
      const thread = all[id] ?? EMPTY_THREAD;
      return { ...all, [id]: { ...thread, ...change(thread) } };
    });
  }, []);

  const handleApiError = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) endSession();
      return error instanceof Error ? error.message : "Something went wrong";
    },
    [endSession]
  );

  /**
   * Loads the chat list from the server. Keeps a newer last message we may have
   * received meanwhile. Unread badges come from the server (unreadCount), except
   * for the chat that's open: it's being read right now.
   */
  const refreshChats = useCallback(() => {
    return getConversations(token)
      .then((conversations) => {
        setChats((current) =>
          sortChats(
            conversations.map((c) => {
              const fromServer = toChat(c);
              const local = current.find((x) => x.id === fromServer.id);
              if (!local?.lastMessage) return fromServer;
              if (!fromServer.lastMessage || local.lastMessage.createdAt > fromServer.lastMessage.createdAt) {
                return { ...fromServer, lastMessage: local.lastMessage };
              }
              // Same message: keep whichever has the further tick.
              if (local.lastMessage.id === fromServer.lastMessage.id) {
                const l = local.lastMessage;
                return { ...fromServer, lastMessage: withStatus(fromServer.lastMessage, l.status, l.deliveredAt, l.readAt) };
              }
              return fromServer;
            })
          )
        );
        setUnread(
          Object.fromEntries(
            conversations.map((c) => [c.id, c.id === activeIdRef.current ? 0 : c.unreadCount ?? 0])
          )
        );
        setChatsError("");
      })
      .catch((error) => setChatsError(handleApiError(error)))
      .finally(() => setLoadingChats(false));
  }, [token, handleApiError]);

  useEffect(() => {
    refreshChats();
  }, [refreshChats]);

  /**
   * Tells the server messages sent to me reached this device (✓✓ for the
   * sender) or were read (blue ✓✓). Covers messageId and everything older in
   * that chat. Over the socket when connected, otherwise over HTTP.
   */
  const ackMessages = useCallback(
    (conversationId: string, status: "delivered" | "read", messageId: string) => {
      if (socket.connected) {
        socket.emit(status === "read" ? "messages_read" : "messages_delivered", { conversationId, messageId });
      } else {
        markConversation(token, conversationId, status, messageId).catch(handleApiError);
      }
    },
    [token, handleApiError]
  );

  /** Opening a chat: the newest page of its history. */
  const loadLatest = useCallback(
    async (id: string) => {
      updateThread(id, () => ({ loading: true, error: "" }));
      try {
        const page = await getMessages(token, id);
        updateThread(id, (t) => ({
          messages: mergeMessages(t.messages, page.messages),
          loaded: true,
          loading: false,
          hasMore: page.hasMore,
        }));
      } catch (error) {
        updateThread(id, () => ({ loading: false, error: handleApiError(error) }));
      }
    },
    [token, updateThread, handleApiError]
  );

  /** Scrolling up: the page just older than what we have. */
  async function loadOlder(id: string) {
    const thread = threads[id];
    const oldest = thread?.messages.find(isSaved);
    if (!thread || !oldest || thread.loadingOlder || !thread.hasMore) return;

    updateThread(id, () => ({ loadingOlder: true }));
    try {
      const page = await getMessages(token, id, { before: oldest.id });
      updateThread(id, (t) => ({
        messages: mergeMessages(page.messages, t.messages),
        hasMore: page.hasMore,
        loadingOlder: false,
      }));
    } catch (error) {
      handleApiError(error);
      updateThread(id, () => ({ loadingOlder: false }));
    }
  }

  /**
   * Saved messages arrived (socket new_message, our own send's reply, or a sync page).
   * Adds them to loaded chats and updates the chat list previews.
   * A newer copy of a message we already have (e.g. now deleted) replaces it.
   * countUnread: only for live socket messages; after a sync the server's
   * unreadCount (refreshChats) is the source of truth instead.
   */
  const receiveMessages = useCallback(
    (msgs: ChatMessage[], countUnread = false) => {
      if (msgs.length === 0) return;

      const byChat = new Map<string, ChatMessage[]>();
      for (const m of msgs) byChat.set(m.conversationId, [...(byChat.get(m.conversationId) ?? []), m]);

      // Only add to chats whose history we've loaded; others load fresh when opened.
      setThreads((all) => {
        let next = all;
        for (const [id, list] of byChat) {
          const thread = all[id];
          if (!thread) continue;
          next = { ...next, [id]: { ...thread, messages: mergeMessages(thread.messages, list) } };
        }
        return next;
      });

      setChats((list) =>
        sortChats(
          list.map((c) => {
            const newest = byChat.get(c.id)?.reduce((a, b) => (b.createdAt >= a.createdAt ? b : a));
            if (!newest) return c;
            if (c.lastMessage?.id === newest.id) {
              const l = c.lastMessage;
              return { ...c, lastMessage: withStatus(newest, l.status, l.deliveredAt, l.readAt) };
            }
            return !c.lastMessage || c.lastMessage.createdAt <= newest.createdAt ? { ...c, lastMessage: newest } : c;
          })
        )
      );

      // Someone started a chat with us: load it into the list.
      const known = new Set(chatsRef.current.map((c) => c.id));
      if ([...byChat.keys()].some((id) => !known.has(id))) refreshChats();

      if (!countUnread) return;
      const counts: Record<string, number> = {};
      for (const m of msgs) {
        const mine = m.senderId === meRef.current.id;
        if (!mine && !m.isDeletedForEveryone && activeIdRef.current !== m.conversationId) {
          counts[m.conversationId] = (counts[m.conversationId] ?? 0) + 1;
        }
      }
      if (Object.keys(counts).length > 0) {
        setUnread((u) => {
          const next = { ...u };
          for (const [id, n] of Object.entries(counts)) next[id] = (next[id] ?? 0) + n;
          return next;
        });
      }
    },
    [refreshChats]
  );

  /** Messages the sender deleted for everyone: show "This message was deleted" in their place. */
  const applyDeletedForEveryone = useCallback((msgs: ChatMessage[]) => {
    if (msgs.length === 0) return;
    const byId = new Map(msgs.map((m) => [m.id, m]));
    setThreads((all) => {
      const next: Record<string, Thread> = {};
      for (const [id, t] of Object.entries(all)) {
        next[id] = t.messages.some((m) => byId.has(m.id))
          ? { ...t, messages: t.messages.map((m) => byId.get(m.id) ?? m) }
          : t;
      }
      return next;
    });
    setChats((list) =>
      list.map((c) => (c.lastMessage && byId.has(c.lastMessage.id) ? { ...c, lastMessage: byId.get(c.lastMessage.id)! } : c))
    );
  }, []);

  /** Messages I deleted for me (here or on another device): remove them and fix the previews. */
  const applyDeletedForMe = useCallback(
    (messageIds: string[]) => {
      if (messageIds.length === 0) return;
      const ids = new Set(messageIds);

      setThreads((all) => {
        const next: Record<string, Thread> = {};
        for (const [id, t] of Object.entries(all)) {
          next[id] = t.messages.some((m) => ids.has(m.id)) ? { ...t, messages: t.messages.filter((m) => !ids.has(m.id)) } : t;
        }
        return next;
      });

      // If a chat's preview was deleted, show the newest message still loaded,
      // then ask the server for the real one (it may be older than what we have).
      const previewGone = chatsRef.current.some((c) => c.lastMessage && ids.has(c.lastMessage.id));
      if (!previewGone) return;
      setChats((list) =>
        list.map((c) => {
          if (!c.lastMessage || !ids.has(c.lastMessage.id)) return c;
          const fallback = threadsRef.current[c.id]?.messages.filter((m) => isSaved(m) && !ids.has(m.id)).at(-1) ?? null;
          return { ...c, lastMessage: fallback };
        })
      );
      refreshChats();
    },
    [refreshChats]
  );

  /** Ticks moved forward (delivered / read): update the bubbles and chat list previews. */
  const applyStatus = useCallback((changes: StatusChange[]) => {
    const byId = new Map<string, StatusChange>();
    for (const c of changes) for (const id of c.messageIds) byId.set(id, c);
    if (byId.size === 0) return;
    const update = <T extends ChatMessage>(m: T) => {
      const c = byId.get(m.id);
      return c ? withStatus(m, c.status, c.deliveredAt, c.readAt) : m;
    };

    setThreads((all) => {
      const next: Record<string, Thread> = {};
      for (const [id, t] of Object.entries(all)) {
        next[id] = t.messages.some((m) => byId.has(m.id)) ? { ...t, messages: t.messages.map(update) } : t;
      }
      return next;
    });
    setChats((list) => list.map((c) => (c.lastMessage && byId.has(c.lastMessage.id) ? { ...c, lastMessage: update(c.lastMessage) } : c)));
  }, []);

  /**
   * Offline catch-up over GET /api/messages/sync (all chats at once):
   * new messages, deletions for everyone, my deletions on other devices and
   * ticks that changed. (The server marks the synced messages as delivered.)
   */
  const syncNow = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    const since = syncedAt.current ?? openedAt;
    try {
      let cursor: string | undefined;
      let nextSyncedAt: string | null = null;
      let gotMessages = false;
      for (;;) {
        const page = await syncMessages(token, since, cursor);
        if (!cursor) {
          // Only the first page carries deletions, tick changes and the new checkpoint.
          nextSyncedAt = page.syncedAt;
          applyDeletedForEveryone(page.deletedForEveryone);
          applyDeletedForMe(page.deletedForMe.map((d) => d.messageId));
          applyStatus(
            (page.statusUpdates ?? []).map((u) => ({
              messageIds: [u.messageId],
              status: u.status,
              deliveredAt: u.deliveredAt,
              readAt: u.readAt,
            }))
          );
        }
        receiveMessages(page.messages);
        gotMessages ||= page.messages.length > 0;
        if (!page.hasMore || page.messages.length === 0) break;
        cursor = page.messages.at(-1)!.id;
      }
      // Only move the checkpoint once every page arrived, so nothing is skipped.
      syncedAt.current = nextSyncedAt;
      // New messages while away: get the real unread counts.
      if (gotMessages) refreshChats();
    } catch (error) {
      handleApiError(error);
    } finally {
      syncing.current = false;
    }
  }, [token, openedAt, receiveMessages, applyDeletedForEveryone, applyDeletedForMe, applyStatus, refreshChats, handleApiError]);

  // Read receipts: while a chat is open and the tab is visible, tell the server
  // we've read up to the newest message from the other person (blue ✓✓ for them).
  const activeMessages = activeId ? threads[activeId]?.messages : undefined;
  const newestIncoming = activeMessages?.filter((m) => isSaved(m) && m.senderId !== me.id).at(-1);
  const readAcked = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!activeId || !visible || !newestIncoming || newestIncoming.status === "read") return;
    if (readAcked.current[activeId] === newestIncoming.id) return;
    readAcked.current[activeId] = newestIncoming.id;
    ackMessages(activeId, "read", newestIncoming.id);
    setUnread((u) => (u[activeId] ? { ...u, [activeId]: 0 } : u));
  }, [activeId, visible, newestIncoming, ackMessages]);

  // Socket handlers are registered once; give them the latest versions of these.
  const latest = useRef({ receiveMessages, applyDeletedForEveryone, applyDeletedForMe, applyStatus, ackMessages, syncNow, refreshChats });
  useEffect(() => {
    latest.current = { receiveMessages, applyDeletedForEveryone, applyDeletedForMe, applyStatus, ackMessages, syncNow, refreshChats };
  });

  // Socket: connect with the JWT and listen for messages, deletions and profile changes.
  useEffect(() => {
    let connectedBefore = false;

    const onConnect = () => {
      setConnected(true);
      // Pick up anything we missed while not connected (first time: since the page loaded).
      if (connectedBefore) {
        latest.current.refreshChats();
        refreshPresence();
      }
      latest.current.syncNow();
      connectedBefore = true;
    };
    const onDisconnect = (reason: string) => {
      setConnected(false);
      // Nobody is typing as far as we can tell any more.
      clearAllTyping();
      // The server closed us on purpose (e.g. I logged out on another device,
      // which ends every session). Socket.IO won't retry that by itself; try
      // once: a dead token fails in connect_error and ends this session too.
      if (reason === "io server disconnect") socket.connect();
    };

    // Online / last seen of everyone in my chat list, e.g. after a reconnect
    // (presence_update events sent while we were away were missed).
    const refreshPresence = () => {
      const userIds = [...new Set(chatsRef.current.map((c) => c.contact.id))].filter((id) => id !== meRef.current.id);
      if (userIds.length === 0) return;
      socket.emit("get_presence", { userIds: userIds.slice(0, 200) }, (res?: { success: boolean; presence?: Presence[] }) => {
        if (res?.success && res.presence) applyPresence(res.presence);
      });
    };
    const applyPresence = (list: Presence[]) => {
      const byId = new Map(list.map((p) => [p.userId, p]));
      setChats((chats) =>
        chats.map((c) => {
          const p = byId.get(c.contact.id);
          return p ? { ...c, contact: { ...c.contact, isOnline: p.isOnline, lastSeenAt: p.lastSeenAt } } : c;
        })
      );
    };
    const onPresenceUpdate = (p: Presence) => p?.userId && applyPresence([p]);

    const setChatTyping = (conversationId: string, isTyping: boolean) => {
      clearTimeout(typingTimers.current[conversationId]);
      delete typingTimers.current[conversationId];
      if (isTyping) {
        typingTimers.current[conversationId] = setTimeout(() => setChatTyping(conversationId, false), TYPING_EXPIRE_MS);
      }
      setTyping((t) => (!!t[conversationId] === isTyping ? t : { ...t, [conversationId]: isTyping }));
    };
    const clearAllTyping = () => {
      Object.values(typingTimers.current).forEach(clearTimeout);
      typingTimers.current = {};
      setTyping({});
    };
    const onTyping = (e: TypingEvent) => {
      if (!e?.conversationId || e.userId === meRef.current.id) return;
      setChatTyping(e.conversationId, e.isTyping);
    };
    const onConnectError = (error: Error) => {
      if (/token|authentication/i.test(error.message)) endSession();
    };
    const onNewMessage = (msg: ChatMessage) => {
      // Their message is here, so they've stopped typing.
      if (msg.senderId !== meRef.current.id) setChatTyping(msg.conversationId, false);
      latest.current.receiveMessages([msg], true);
      // Reached this device: ✓✓ for the sender. (If the chat is open and on
      // screen, the read receipt effect sends "read" instead, which implies it.)
      const onScreen = activeIdRef.current === msg.conversationId && visibleRef.current;
      if (msg.senderId !== meRef.current.id && !onScreen) {
        latest.current.ackMessages(msg.conversationId, "delivered", msg.id);
      }
    };
    // Ticks changed. userId is who got/read them; when it's me, I read the
    // chat on another device, so clear those from my unread badge here too.
    const onMessageStatus = (e: MessageStatusEvent) => {
      if (!e?.messageIds?.length) return;
      latest.current.applyStatus([
        { messageIds: e.messageIds, status: e.status, deliveredAt: e.at, readAt: e.status === "read" ? e.at : null },
      ]);
      if (e.userId === meRef.current.id && e.status === "read") {
        setUnread((u) => (u[e.conversationId] ? { ...u, [e.conversationId]: Math.max(0, u[e.conversationId] - e.messageIds.length) } : u));
      }
    };
    const onDeletedForEveryone = (e: DeletedForEveryoneEvent) => latest.current.applyDeletedForEveryone(e?.messages ?? []);
    const onDeletedForMe = (e: DeletedForMeEvent) => latest.current.applyDeletedForMe(e?.messageIds ?? []);

    // Someone changed their name/username/photo: update the chat list, headers and our own profile.
    const onProfileUpdated = (update: ProfileUpdate) => {
      const changes = { name: update.name, username: update.username, profileImage: update.profileImage };
      setChats((list) =>
        list.map((c) => (c.contact.id === update.id ? { ...c, contact: { ...c.contact, ...changes } } : c))
      );
      if (update.id === meRef.current.id) {
        setUser({ ...meRef.current, ...changes });
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("new_message", onNewMessage);
    socket.on("message_deleted_for_everyone", onDeletedForEveryone);
    socket.on("message_deleted_for_me", onDeletedForMe);
    socket.on("message_status", onMessageStatus);
    socket.on("profile_updated", onProfileUpdated);
    socket.on("presence_update", onPresenceUpdate);
    socket.on("typing", onTyping);

    connectSocket(token);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("new_message", onNewMessage);
      socket.off("message_deleted_for_everyone", onDeletedForEveryone);
      socket.off("message_deleted_for_me", onDeletedForMe);
      socket.off("message_status", onMessageStatus);
      socket.off("profile_updated", onProfileUpdated);
      socket.off("presence_update", onPresenceUpdate);
      socket.off("typing", onTyping);
      clearAllTyping();
      socket.disconnect();
    };
  }, [token, endSession, setUser]);

  /**
   * My typing in the open chat, from the composer. The server expires
   * "typing" after ~6s, so typing_start is repeated every few seconds while
   * I keep typing (the composer throttles it).
   */
  const sendTyping = useCallback((conversationId: string, isTyping: boolean) => {
    if (!socket.connected) return;
    socket.emit(isTyping ? "typing_start" : "typing_stop", { conversationId });
  }, []);

  function openChat(id: string) {
    setActiveId(id);
    setShowInfo(false);
    setUnread((u) => ({ ...u, [id]: 0 }));
    const thread = threads[id];
    if (!thread?.loaded && !thread?.loading) loadLatest(id);
  }

  /** Found someone: create/reopen the chat on the server, then open it. */
  async function startChatWith(person: SearchResult) {
    const conversation = await startConversation(token, person.id);
    const chat = toChat(conversation);
    setChats((list) => sortChats([chat, ...list.filter((c) => c.id !== chat.id)]));
    setShowNewChat(false);
    openChat(chat.id);
  }

  /**
   * Saves the message on the server: over the socket if connected, otherwise over HTTP.
   * The same clientMessageId on a retry means the server never stores it twice.
   */
  function deliver(conversationId: string, content: string, clientMessageId: string): Promise<ChatMessage> {
    if (!socket.connected) return postMessage(token, conversationId, content, clientMessageId);

    return new Promise((resolve, reject) => {
      socket
        .timeout(SEND_TIMEOUT_MS)
        .emit(
          "send_message",
          { conversationId, content, clientMessageId },
          (err: Error | null, res?: { success: boolean; message?: ChatMessage; error?: string }) => {
            if (err) return reject(new Error("The server didn't answer"));
            if (!res?.success || !res.message) return reject(new Error(res?.error || "Message failed"));
            resolve(res.message);
          }
        );
    });
  }

  /**
   * Shows the message straight away (with a clock), then swaps in the saved copy (✓).
   * retryOf: a failed message to send again, keeping its clientMessageId.
   */
  async function sendMessage(content: string, conversationId = activeId, retryOf?: DisplayMessage) {
    if (!conversationId) return;

    const clientMessageId = retryOf?.clientMessageId ?? crypto.randomUUID();
    const tempId = retryOf?.id ?? `temp-${clientMessageId}`;
    if (retryOf) {
      updateThread(conversationId, (t) => ({
        messages: t.messages.map((m) => (m.id === tempId ? { ...m, sendState: "sending" as const } : m)),
      }));
    } else {
      const now = new Date().toISOString();
      const pending: DisplayMessage = {
        id: tempId,
        conversationId,
        senderId: me.id,
        content,
        createdAt: now,
        isDeletedForEveryone: false,
        deletedAt: null,
        clientMessageId,
        status: "sent",
        sentAt: now,
        deliveredAt: null,
        readAt: null,
        sender: { id: me.id, name: me.name, username: me.username, profileImage: me.profileImage },
        sendState: "sending",
      };
      updateThread(conversationId, (t) => ({ messages: [...t.messages, pending] }));
    }

    try {
      const saved = await deliver(conversationId, content, clientMessageId);
      updateThread(conversationId, (t) => ({
        messages: mergeMessages(t.messages.filter((m) => m.id !== tempId), [saved]),
      }));
      receiveMessages([saved]);
    } catch (error) {
      handleApiError(error);
      updateThread(conversationId, (t) => ({
        messages: t.messages.map((m) => (m.id === tempId ? { ...m, sendState: "failed" as const } : m)),
      }));
    }
  }

  function retryMessage(msg: DisplayMessage) {
    sendMessage(msg.content, msg.conversationId, msg);
  }

  /**
   * Delete from the message menu or the selection bar. Messages that never
   * reached the server ("failed") are just removed from the screen.
   * Throws a readable error for the dialog to show.
   */
  async function deleteMessages(msgs: DisplayMessage[], mode: DeleteMode) {
    const savedIds = msgs.filter(isSaved).map((m) => m.id);
    const localIds = msgs.filter((m) => m.sendState === "failed").map((m) => m.id);
    try {
      for (let i = 0; i < savedIds.length; i += DELETE_BATCH) {
        const batch = savedIds.slice(i, i + DELETE_BATCH);
        if (mode === "everyone") applyDeletedForEveryone(await deleteMessagesForEveryone(token, batch));
        else await deleteMessagesForMe(token, batch);
      }
    } catch (error) {
      throw new Error(handleApiError(error));
    }
    // The socket echo does the same; doing it now keeps the UI instant.
    applyDeletedForMe(mode === "me" ? [...savedIds, ...localIds] : localIds);
  }

  const active = chats.find((c) => c.id === activeId) ?? null;
  const q = filter.trim().toLowerCase().replace(/^@/, "");
  const shownChats = q
    ? chats.filter((c) => c.contact.name.toLowerCase().includes(q) || c.contact.username?.toLowerCase().includes(q))
    : chats;

  const iconButton = "rounded-full p-2 text-[#54656f] transition hover:bg-black/5";

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-[#d1d7db]">
      {/* WhatsApp Web's green band behind the app on large screens */}
      <div className="absolute inset-x-0 top-0 hidden h-[127px] bg-[#00a884] xl:block" />

      <div className="relative mx-auto flex h-full w-full max-w-[1600px] overflow-hidden bg-white shadow-[0_6px_18px_rgba(11,20,26,.05)] xl:my-[19px] xl:h-[calc(100%-38px)] xl:w-[calc(100%-38px)]">
        {/* ── Sidebar: my profile + chat list ── */}
        <aside
          className={`${active ? "hidden md:flex" : "flex"} w-full flex-col border-r border-[#d1d7db] bg-white md:w-[40%] md:max-w-[420px] md:min-w-[300px] md:shrink-0`}
        >
          <header className="flex h-[59px] shrink-0 items-center gap-1 bg-[#f0f2f5] px-4">
            <Link href="/profile" className="mr-auto rounded-full" title="Profile">
              <Avatar name={me.name} image={me.profileImage} seed={me.id} className="h-10 w-10 text-sm" />
            </Link>
            <button onClick={() => setShowNewChat(true)} className={iconButton} title="New chat" aria-label="New chat">
              <MessageSquarePlus className="h-5 w-5" />
            </button>
            <button onClick={logout} className={iconButton} title="Log out" aria-label="Log out">
              <LogOut className="h-5 w-5" />
            </button>
          </header>

          {!connected && (
            <div className="flex items-center gap-3 bg-[#ffe9b5] px-4 py-3 text-[#3b4a54]">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-[#f0b330]">
                <WifiOff className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[15px]">Connecting to the server...</p>
                <p className="text-[13px] text-[#667781]">Messages you send will go out when you&apos;re back online.</p>
              </div>
            </div>
          )}

          {/* Search / filter chats */}
          <div className="border-b border-[#e9edef] bg-white px-3 py-[7px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#54656f]" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search or start a new chat"
                className="h-[35px] w-full rounded-lg bg-[#f0f2f5] pl-12 pr-9 text-sm text-[#111b21] outline-none placeholder:text-[#667781]"
              />
              {filter && (
                <button
                  onClick={() => setFilter("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[#54656f] hover:bg-black/5"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {chatsError && (
              <div className="m-3 flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                <span>{chatsError}</span>
                <button onClick={() => refreshChats()} className="font-medium text-[#008069] hover:underline">Retry</button>
              </div>
            )}
            {loadingChats && chats.length === 0 ? (
              <div className="flex justify-center py-16">
                <LoaderCircle className="h-7 w-7 animate-spin text-[#00a884]" />
              </div>
            ) : chats.length === 0 ? (
              <div className="px-8 py-16 text-center">
                <MessageCircle className="mx-auto mb-3 h-12 w-12 text-[#d1d7db]" />
                <p className="text-[#111b21]">No chats yet</p>
                <p className="mt-1 text-sm text-[#667781]">Find people by username or phone number.</p>
                <button
                  onClick={() => setShowNewChat(true)}
                  className="mt-5 rounded-full bg-[#00a884] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#008f72]"
                >
                  Start a new chat
                </button>
              </div>
            ) : shownChats.length === 0 ? (
              <div className="px-8 py-10 text-center text-sm text-[#667781]">
                No chats match &ldquo;{filter.trim()}&rdquo;.
                <button onClick={() => setShowNewChat(true)} className="mt-3 block w-full text-[#008069] hover:underline">
                  Search all users
                </button>
              </div>
            ) : (
              <ul>
                {shownChats.map((chat) => {
                  const c = chat.contact;
                  const last = chat.lastMessage;
                  const count = unread[chat.id] ?? 0;
                  const lastMine = last?.senderId === me.id;
                  return (
                    <li key={chat.id}>
                      <button
                        onClick={() => openChat(chat.id)}
                        className={`flex h-[72px] w-full items-center gap-3 pl-3 text-left transition ${
                          chat.id === activeId ? "bg-[#f0f2f5]" : "hover:bg-[#f5f6f6]"
                        }`}
                      >
                        <Avatar name={c.name} image={c.profileImage} seed={c.id} className="h-[49px] w-[49px] text-sm" />
                        <div className="flex h-full min-w-0 flex-1 flex-col justify-center border-b border-[#e9edef] pr-4">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="truncate text-[17px] text-[#111b21]">
                              {c.name}
                              {c.id === me.id && <span className="text-[#667781]"> (You)</span>}
                            </p>
                            {last && (
                              <span className={`shrink-0 text-xs ${count ? "text-[#1fa855]" : "text-[#667781]"}`}>
                                {formatListTime(last.createdAt)}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center justify-between gap-2">
                            <p className="flex min-w-0 items-center gap-1 text-sm text-[#667781]">
                              {typing[chat.id] ? (
                                <span className="truncate text-[#1fa855]">typing...</span>
                              ) : last?.isDeletedForEveryone ? (
                                <>
                                  <Ban className="h-4 w-4 shrink-0" />
                                  <span className="truncate italic">{deletedText(lastMine)}</span>
                                </>
                              ) : (
                                <>
                                  {lastMine && last && <MessageTicks message={last} className="h-4 w-4 shrink-0" />}
                                  <span className="truncate">{last ? last.content : c.username ? `@${c.username}` : ""}</span>
                                </>
                              )}
                            </p>
                            {count > 0 && (
                              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#25d366] px-1.5 text-xs font-medium text-white">
                                {count}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* ── Conversation ── */}
        {active ? (
          <>
            <ConversationPanel
              key={active.id}
              me={me}
              conversationId={active.id}
              contact={active.contact}
              thread={threads[active.id] ?? EMPTY_THREAD}
              connected={connected}
              typing={!!typing[active.id]}
              onTyping={sendTyping}
              onSend={(text) => sendMessage(text)}
              onRetry={retryMessage}
              onDelete={deleteMessages}
              onLoadOlder={() => loadOlder(active.id)}
              onReload={() => loadLatest(active.id)}
              onBack={() => setActiveId(null)}
              onOpenInfo={() => setShowInfo(true)}
            />
            {showInfo && (
              <ContactInfo contact={active.contact} isSelf={active.contact.id === me.id} onClose={() => setShowInfo(false)} />
            )}
          </>
        ) : (
          <section className="hidden flex-1 flex-col items-center justify-center border-b-[6px] border-[#25d366] bg-[#f0f2f5] text-center md:flex">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#00a884]/10 text-[#00a884]">
              <MessageCircle className="h-12 w-12" />
            </div>
            <h2 className="mt-8 text-[32px] font-light text-[#41525d]">ChatApp Web</h2>
            <p className="mt-4 max-w-md text-sm leading-5 text-[#667781]">
              Send and receive messages in real time. Pick a chat on the left, or start a new one by searching a username or phone number.
            </p>
          </section>
        )}

        {showNewChat && (
          <NewChatDialog
            token={token}
            onClose={() => setShowNewChat(false)}
            onUnauthorized={endSession}
            myId={me.id}
            onStartChat={startChatWith}
          />
        )}
      </div>
    </div>
  );
}

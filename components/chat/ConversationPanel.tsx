"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Ban,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  EllipsisVertical,
  LoaderCircle,
  SendHorizontal,
  Trash2,
  X,
} from "lucide-react";
import Avatar from "@/components/Avatar";
import type { Contact, User } from "@/services/auth";
import DeleteMessagesDialog, { type DeleteMode } from "./DeleteMessagesDialog";
import MessageTicks, { READ_BLUE } from "./MessageTicks";
import { deletedText, formatDayLabel, formatLastSeen, formatTime, type DisplayMessage } from "./types";

/** Repeat typing_start this often while typing (server forgets it after 6s). */
const TYPING_REPEAT_MS = 3_000;
/** Send typing_stop after this long without a keystroke. */
const TYPING_IDLE_MS = 4_000;

/** One chat's messages as loaded from the server (plus any still sending). */
export type Thread = {
  messages: DisplayMessage[];
  loaded: boolean; // newest page fetched
  loading: boolean;
  hasMore: boolean; // older messages exist on the server
  loadingOlder: boolean;
  error: string;
};

type ConversationPanelProps = {
  me: User;
  conversationId: string;
  contact: Contact;
  thread: Thread;
  connected: boolean;
  /** The other person is typing right now. */
  typing: boolean;
  /** I started / stopped typing in this chat. */
  onTyping: (conversationId: string, isTyping: boolean) => void;
  onSend: (text: string) => void;
  onRetry: (msg: DisplayMessage) => void;
  onDelete: (messages: DisplayMessage[], mode: DeleteMode) => Promise<void>;
  onLoadOlder: () => void;
  onReload: () => void;
  onBack: () => void;
  onOpenInfo: () => void;
};

const MAX_LENGTH = 2000;

/** Messages still on their way can't be selected or deleted yet. */
const selectable = (m: DisplayMessage) => m.sendState !== "sending";

export default function ConversationPanel({
  me,
  conversationId,
  contact,
  thread,
  connected,
  typing,
  onTyping,
  onSend,
  onRetry,
  onDelete,
  onLoadOlder,
  onReload,
  onBack,
  onOpenInfo,
}: ConversationPanelProps) {
  const [input, setInput] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ id: string; up: boolean } | null>(null);
  const [headerMenu, setHeaderMenu] = useState(false);
  const [toDelete, setToDelete] = useState<DisplayMessage[] | null>(null);
  // "Message info" for this message id (looked up live, so ticks update while it's open).
  const [infoId, setInfoId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prev = useRef<{ first?: string; last?: string; height: number; top: number }>({ height: 0, top: 0 });
  const isSelf = contact.id === me.id;
  const { messages } = thread;

  // Selected messages that still exist (some may have been deleted on another device).
  const selected = messages.filter((m) => selectedIds.has(m.id));
  const infoMessage = infoId ? messages.find((m) => m.id === infoId && !m.isDeletedForEveryone) : undefined;

  // Keep the scroll position sensible as messages change:
  //  - first load: jump to the newest message
  //  - older page added on top: stay where you were
  //  - new message at the bottom: follow it if you were near the bottom (or sent it)
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const first = messages[0]?.id;
    const last = messages.at(-1)?.id;
    const p = prev.current;

    if (!p.last && last) {
      el.scrollTop = el.scrollHeight;
    } else if (first !== p.first && last === p.last) {
      el.scrollTop = p.top + (el.scrollHeight - p.height);
    } else if (last !== p.last) {
      const wasNearBottom = p.height - p.top - el.clientHeight < 150;
      if (wasNearBottom || messages.at(-1)?.senderId === me.id) {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }
    }
    prev.current = { first, last, height: el.scrollHeight, top: el.scrollTop };
  }, [messages, me.id]);

  // Grow the text box with its content, up to ~6 lines (like WhatsApp).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [input]);

  // Escape closes the innermost thing that's open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || toDelete) return; // the dialog handles its own state
      if (infoId) setInfoId(null);
      else if (menu) setMenu(null);
      else if (headerMenu) setHeaderMenu(false);
      else if (selecting) exitSelection();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, headerMenu, selecting, toDelete, infoId]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    prev.current.top = el.scrollTop;
    if (menu) setMenu(null);
    if (el.scrollTop < 80 && thread.hasMore && !thread.loadingOlder) onLoadOlder();
  }

  // My "typing..." for the other person: typing_start right away, repeated
  // every few seconds while I keep typing (the server expires it after 6s),
  // and typing_stop after a pause or when the box is cleared.
  const typingSentAt = useRef(0); // 0 = not marked as typing
  const typingIdle = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onTypingRef = useRef(onTyping);
  useEffect(() => {
    onTypingRef.current = onTyping;
  });

  const stopTyping = useCallback(
    (notify = true) => {
      clearTimeout(typingIdle.current);
      if (!typingSentAt.current) return;
      typingSentAt.current = 0;
      if (notify) onTypingRef.current(conversationId, false);
    },
    [conversationId]
  );

  // Leaving the chat (or the page) ends typing.
  useEffect(() => () => stopTyping(), [stopTyping]);

  function handleInput(value: string) {
    setInput(value);
    if (!value.trim()) return stopTyping();
    const now = Date.now();
    if (now - typingSentAt.current > TYPING_REPEAT_MS) {
      typingSentAt.current = now;
      onTyping(conversationId, true);
    }
    clearTimeout(typingIdle.current);
    typingIdle.current = setTimeout(() => stopTyping(), TYPING_IDLE_MS);
  }

  function send() {
    const text = input.trim();
    if (!text) return;
    // The server stops "typing..." itself when the message is saved.
    stopTyping(false);
    onSend(text);
    setInput("");
  }

  function exitSelection() {
    setSelecting(false);
    setSelectedIds(new Set());
  }

  function toggle(id: string) {
    setSelectedIds((ids) => {
      const next = new Set(ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openMenu(id: string, button: HTMLElement) {
    // Open upwards when the bubble is close to the bottom of the screen.
    const up = window.innerHeight - button.getBoundingClientRect().bottom < 140;
    setMenu({ id, up });
  }

  const canDeleteForEveryone = (list: DisplayMessage[]) =>
    list.length > 0 && list.every((m) => m.senderId === me.id && !m.sendState && !m.isDeletedForEveryone);

  const iconButton = "rounded-full p-2 text-[#54656f] transition hover:bg-black/5";

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-[#efeae2]">
      {/* Header: the other person's photo + name. Click opens contact info. */}
      <header className="relative z-10 flex h-[59px] shrink-0 items-center gap-1 border-l border-[#d1d7db] bg-[#f0f2f5] px-2 sm:px-4">
        <button onClick={onBack} className={`${iconButton} md:hidden`} aria-label="Back to chats">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button onClick={onOpenInfo} className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left">
          <Avatar name={contact.name} image={contact.profileImage} seed={contact.id} className="h-10 w-10 text-sm" />
          <div className="min-w-0">
            <p className="truncate text-base text-[#111b21]">
              {contact.name}
              {isSelf && <span className="text-[#667781]"> (You)</span>}
            </p>
            <p className={`truncate text-[13px] ${typing && !isSelf ? "text-[#1fa855]" : "text-[#667781]"}`}>
              {isSelf
                ? "Message yourself"
                : typing
                  ? "typing..."
                  : !connected
                    ? "connecting..."
                    : contact.isOnline
                      ? "online"
                      : contact.lastSeenAt
                        ? formatLastSeen(contact.lastSeenAt)
                        : "click here for contact info"}
            </p>
          </div>
        </button>
        <div className="relative">
          <button
            onClick={() => setHeaderMenu((v) => !v)}
            className={`${iconButton} ${headerMenu ? "bg-black/10" : ""}`}
            aria-label="Menu"
            aria-expanded={headerMenu}
          >
            <EllipsisVertical className="h-5 w-5" />
          </button>
          {headerMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setHeaderMenu(false)} />
              <ul className="absolute right-0 top-11 z-20 w-52 rounded-[3px] bg-white py-2 text-[14.5px] text-[#3b4a54] shadow-[0_2px_5px_0_rgba(11,20,26,.26),0_2px_10px_0_rgba(11,20,26,.16)]">
                {[
                  { label: "Contact info", run: onOpenInfo },
                  { label: "Select messages", run: () => setSelecting(true) },
                  { label: "Close chat", run: onBack },
                ].map((item) => (
                  <li key={item.label}>
                    <button
                      onClick={() => {
                        setHeaderMenu(false);
                        item.run();
                      }}
                      className="w-full px-6 py-2.5 text-left hover:bg-[#f5f6f6]"
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="chat-wallpaper flex-1 overflow-y-auto px-3 py-4 sm:px-[6%]">
        {thread.loadingOlder && (
          <div className="mb-3 flex justify-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow">
              <LoaderCircle className="h-5 w-5 animate-spin text-[#00a884]" />
            </span>
          </div>
        )}

        {thread.loading && messages.length === 0 && (
          <div className="flex justify-center py-10">
            <LoaderCircle className="h-7 w-7 animate-spin text-[#00a884]" />
          </div>
        )}

        {thread.error && (
          <div className="mx-auto mb-3 flex max-w-sm items-center justify-between gap-3 rounded-lg bg-white px-4 py-2.5 text-sm text-red-700 shadow-sm">
            <span>{thread.error}</span>
            <button onClick={onReload} className="font-medium text-[#008069] hover:underline">Retry</button>
          </div>
        )}

        {thread.loaded && messages.length === 0 && (
          <div className="mx-auto mt-6 max-w-sm rounded-lg bg-[#ffeecd] px-4 py-2 text-center text-[12.5px] text-[#54656f] shadow-sm">
            No messages here yet. Say hi to {contact.name} 👋
          </div>
        )}

        <div>
          {messages.map((msg, i) => {
            const before = messages[i - 1];
            const isMine = msg.senderId === me.id;
            const day = formatDayLabel(msg.createdAt);
            const newDay = !before || formatDayLabel(before.createdAt) !== day;
            // First bubble of a run from the same person gets the "tail".
            const firstOfGroup = newDay || before.senderId !== msg.senderId;
            const isSelected = selectedIds.has(msg.id);
            const canSelect = selectable(msg);

            return (
              <div key={msg.id}>
                {newDay && (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-lg bg-white px-3 py-1.5 text-[12.5px] uppercase text-[#54656f] shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
                      {day}
                    </span>
                  </div>
                )}

                <div
                  onClick={selecting && canSelect ? () => toggle(msg.id) : undefined}
                  className={`-mx-2 flex items-start rounded-md px-2 ${firstOfGroup ? "mt-3" : "mt-0.5"} ${
                    selecting && canSelect ? "cursor-pointer" : ""
                  } ${isSelected ? "bg-[#00a884]/15" : ""}`}
                >
                  {selecting && (
                    <span className="mr-3 mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center">
                      {canSelect && (
                        <span
                          className={`flex h-[18px] w-[18px] items-center justify-center rounded-[3px] border-2 ${
                            isSelected ? "border-[#00a884] bg-[#00a884]" : "border-[#8696a0] bg-white"
                          }`}
                        >
                          {isSelected && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                        </span>
                      )}
                    </span>
                  )}

                  <div className={`flex min-w-0 flex-1 py-px ${isMine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`group relative max-w-[85%] rounded-lg px-2 pb-2 pt-1.5 text-[14.2px] leading-[19px] text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,.13)] md:max-w-[65%] ${
                        isMine ? "bg-[#d9fdd3]" : "bg-white"
                      } ${firstOfGroup ? (isMine ? "rounded-tr-none" : "rounded-tl-none") : ""}`}
                    >
                      {firstOfGroup && (
                        <svg
                          viewBox="0 0 8 13"
                          aria-hidden
                          className={`absolute top-0 h-[13px] w-2 ${isMine ? "-right-2 text-[#d9fdd3]" : "-left-2 text-white"}`}
                        >
                          <path
                            fill="currentColor"
                            d={isMine ? "M0 0h5.19C6.96 0 7.53 1.16 6.47 2.57L0 11.19z" : "M8 0H2.81C1.04 0 .47 1.16 1.53 2.57L8 11.19z"}
                          />
                        </svg>
                      )}

                      {msg.isDeletedForEveryone ? (
                        <span className="flex items-center gap-1.5 italic text-[#667781]">
                          <Ban className="h-4 w-4 shrink-0" />
                          {deletedText(isMine)}
                          <span className="inline-block w-12" />
                        </span>
                      ) : (
                        <span className="whitespace-pre-wrap break-words">
                          {msg.content}
                          {/* Leaves room for the time on the last line. */}
                          <span className={`inline-block ${isMine ? "w-[72px]" : "w-[52px]"}`} />
                        </span>
                      )}

                      <span className="absolute bottom-1 right-2 flex items-center gap-0.5 text-[11px] text-[#667781]">
                        {formatTime(msg.createdAt)}
                        {isMine && !msg.isDeletedForEveryone && <MessageTicks message={msg} className="ml-0.5 h-4 w-4" />}
                      </span>

                      {/* Hover arrow -> message menu */}
                      {!selecting && canSelect && (
                        <button
                          onClick={(e) => openMenu(msg.id, e.currentTarget)}
                          className={`absolute right-1 top-1 rounded-full pl-3 text-[#8696a0] opacity-0 transition group-hover:opacity-100 focus:opacity-100 ${
                            menu?.id === msg.id ? "opacity-100" : ""
                          } ${isMine ? "bg-gradient-to-l from-[#d9fdd3] from-60%" : "bg-gradient-to-l from-white from-60%"}`}
                          aria-label="Message options"
                        >
                          <ChevronDown className="h-5 w-5" />
                        </button>
                      )}

                      {menu?.id === msg.id && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} />
                          <ul
                            className={`absolute right-0 z-20 w-44 rounded-[3px] bg-white py-2 text-[14.5px] text-[#3b4a54] shadow-[0_2px_5px_0_rgba(11,20,26,.26),0_2px_10px_0_rgba(11,20,26,.16)] ${
                              menu.up ? "bottom-7" : "top-7"
                            }`}
                          >
                            {isMine && !msg.sendState && !msg.isDeletedForEveryone && (
                              <li>
                                <button
                                  onClick={() => {
                                    setMenu(null);
                                    setInfoId(msg.id);
                                  }}
                                  className="w-full px-6 py-2.5 text-left hover:bg-[#f5f6f6]"
                                >
                                  Message info
                                </button>
                              </li>
                            )}
                            <li>
                              <button
                                onClick={() => {
                                  setMenu(null);
                                  setSelecting(true);
                                  setSelectedIds(new Set([msg.id]));
                                }}
                                className="w-full px-6 py-2.5 text-left hover:bg-[#f5f6f6]"
                              >
                                Select
                              </button>
                            </li>
                            <li>
                              <button
                                onClick={() => {
                                  setMenu(null);
                                  setToDelete([msg]);
                                }}
                                className="w-full px-6 py-2.5 text-left hover:bg-[#f5f6f6]"
                              >
                                Delete
                              </button>
                            </li>
                          </ul>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {msg.sendState === "failed" && !selecting && (
                  <div className="mt-1 flex justify-end">
                    <button
                      onClick={() => onRetry(msg)}
                      className="flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-0.5 text-xs text-red-600 shadow-sm hover:underline"
                    >
                      <CircleAlert className="h-3.5 w-3.5" />
                      Not sent. Click to retry
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer: the composer, or the selection bar while selecting */}
      {selecting ? (
        <div className="flex h-[62px] shrink-0 items-center gap-4 bg-[#f0f2f5] px-4">
          <button onClick={exitSelection} className={iconButton} aria-label="Cancel selection">
            <X className="h-6 w-6" />
          </button>
          <span className="flex-1 text-[15px] text-[#3b4a54]">{selected.length} selected</span>
          <button
            onClick={() => setToDelete(selected)}
            disabled={selected.length === 0}
            className={`${iconButton} disabled:opacity-40 disabled:hover:bg-transparent`}
            aria-label="Delete selected messages"
            title="Delete"
          >
            <Trash2 className="h-6 w-6" />
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex shrink-0 items-end gap-2 bg-[#f0f2f5] px-3 py-[9px] sm:px-4"
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => handleInput(e.target.value)}
            onBlur={() => stopTyping()}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter adds a new line.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Type a message"
            maxLength={MAX_LENGTH}
            className="max-h-[132px] flex-1 resize-none rounded-lg bg-white px-3 py-[9px] text-[15px] leading-5 text-[#111b21] outline-none placeholder:text-[#667781]"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full transition ${
              input.trim() ? "bg-[#00a884] text-white hover:bg-[#008f72]" : "text-[#8696a0]"
            }`}
            aria-label="Send"
          >
            <SendHorizontal className="h-5 w-5" />
          </button>
        </form>
      )}

      {infoMessage && <MessageInfo message={infoMessage} onClose={() => setInfoId(null)} />}

      {toDelete && toDelete.length > 0 && (
        <DeleteMessagesDialog
          count={toDelete.length}
          canDeleteForEveryone={canDeleteForEveryone(toDelete)}
          onClose={() => setToDelete(null)}
          onDelete={async (mode) => {
            await onDelete(toDelete, mode);
            exitSelection();
          }}
        />
      )}
    </section>
  );
}

/** "Today at 14:05" / "Yesterday at 09:12" / "19 November 2026 at 18:40". */
function formatStamp(iso: string) {
  return `${formatDayLabel(iso)} at ${formatTime(iso)}`;
}

/** WhatsApp's "Message info": the bubble, then when it was read / delivered / sent. */
function MessageInfo({ message, onClose }: { message: DisplayMessage; onClose: () => void }) {
  const rows = [
    { label: "Read", icon: <CheckCheck className={`h-4 w-4 ${READ_BLUE}`} />, at: message.readAt },
    { label: "Delivered", icon: <CheckCheck className="h-4 w-4 text-[#667781]" />, at: message.deliveredAt },
    { label: "Sent", icon: <Check className="h-4 w-4 text-[#667781]" />, at: message.sentAt ?? message.createdAt },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="message-info-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] overflow-hidden rounded-[3px] bg-[#f0f2f5] shadow-[0_17px_50px_0_rgba(11,20,26,.19),0_12px_15px_0_rgba(11,20,26,.24)]"
      >
        <div className="flex h-[59px] items-center gap-4 bg-[#f0f2f5] px-4">
          <button onClick={onClose} className="rounded-full p-2 text-[#54656f] hover:bg-black/5" aria-label="Close message info">
            <X className="h-5 w-5" />
          </button>
          <h2 id="message-info-title" className="text-base text-[#111b21]">Message info</h2>
        </div>

        <div className="chat-wallpaper flex justify-end px-6 py-6">
          <div className="relative max-w-[85%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-2 pb-2 pt-1.5 text-[14.2px] leading-[19px] text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
            <span className="line-clamp-6 whitespace-pre-wrap break-words">
              {message.content}
              <span className="inline-block w-[72px]" />
            </span>
            <span className="absolute bottom-1 right-2 flex items-center gap-0.5 text-[11px] text-[#667781]">
              {formatTime(message.createdAt)}
              <MessageTicks message={message} className="ml-0.5 h-4 w-4" />
            </span>
          </div>
        </div>

        <ul className="divide-y divide-[#e9edef] bg-white">
          {rows.map((row) => (
            <li key={row.label} className="px-6 py-3.5">
              <p className="flex items-center gap-2 text-[15px] text-[#111b21]">
                {row.icon}
                {row.label}
              </p>
              <p className="mt-0.5 pl-6 text-sm text-[#667781]">{row.at ? formatStamp(row.at) : "—"}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

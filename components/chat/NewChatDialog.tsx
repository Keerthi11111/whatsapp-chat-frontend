"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, AtSign, LoaderCircle, MessageCircle, Phone, Search, UserX, X } from "lucide-react";
import Avatar from "@/components/Avatar";
import { ApiError, looksLikePhone, searchUsers, type SearchResult } from "@/services/auth";

type NewChatDialogProps = {
  token: string;
  myId: string;
  onClose: () => void;
  /** Start (or reopen) the chat with this person. */
  onStartChat: (user: SearchResult) => Promise<void>;
  onUnauthorized: () => void;
};

/** A username search needs 2+ characters (after an optional "@"); a phone search needs 7+ digits. */
function isSearchable(q: string) {
  const trimmed = q.trim();
  return looksLikePhone(trimmed) || trimmed.replace(/^@/, "").length >= 2;
}

export default function NewChatDialog({ token, myId, onClose, onStartChat, onUnauthorized }: NewChatDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ query: string; users: SearchResult[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [starting, setStarting] = useState(false);
  const latestQuery = useRef("");

  // Search as you type (debounced). Ignores answers to older queries.
  useEffect(() => {
    const q = query.trim();
    latestQuery.current = q;
    if (!isSearchable(q)) return;

    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      searchUsers(token, q)
        .then((users) => {
          if (latestQuery.current === q) setResults({ query: q, users });
        })
        .catch((err) => {
          if (err instanceof ApiError && err.status === 401) return onUnauthorized();
          if (latestQuery.current === q) setError(err instanceof Error ? err.message : "Search failed");
        })
        .finally(() => {
          if (latestQuery.current === q) setLoading(false);
        });
    }, 300);

    return () => clearTimeout(timer);
  }, [query, token, onUnauthorized]);

  async function handleStart(user: SearchResult) {
    setStarting(true);
    setError("");
    try {
      await onStartChat(user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onUnauthorized();
      setError(err instanceof Error ? err.message : "Could not start chat");
      setStarting(false);
    }
  }

  const searchable = isSearchable(query);
  const shown = searchable && results?.query === query.trim() ? results.users : null;
  const phoneSearch = looksLikePhone(query);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-white/80 p-4 pt-[10vh]" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[75vh] w-full max-w-md flex-col overflow-hidden rounded-[3px] bg-white shadow-[0_17px_50px_0_rgba(11,20,26,.19),0_12px_15px_0_rgba(11,20,26,.24)]">
        {selected ? (
          /* ── Profile preview ── */
          <div className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
              <button onClick={() => { setSelected(null); setError(""); }} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Back to search">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <h2 className="flex-1 font-semibold text-slate-900">Profile</h2>
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-col items-center px-6 pb-6 pt-8 text-center">
              <Avatar name={selected.name} image={selected.profileImage} seed={selected.id} className="h-32 w-32 text-4xl shadow-lg" />
              <h3 className="mt-4 text-2xl font-semibold text-slate-900">
                {selected.name}
                {selected.id === myId && <span className="font-normal text-slate-500"> (You)</span>}
              </h3>
              <p className="mt-1 flex items-center gap-1 text-slate-500">
                <AtSign className="h-4 w-4" />
                {selected.username}
              </p>
              {selected.phone && (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                  <Phone className="h-4 w-4" />
                  {selected.phone}
                </p>
              )}

              {error && <div className="mt-5 w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

              <button
                onClick={() => handleStart(selected)}
                disabled={starting}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#00a884] py-3 font-medium text-white transition hover:bg-[#008f72] disabled:opacity-60"
              >
                {starting ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <MessageCircle className="h-5 w-5" />}
                {selected.id === myId ? "Message yourself" : "Message"}
              </button>
            </div>
          </div>
        ) : (
          /* ── Search ── */
          <>
            <div className="border-b border-slate-100 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">New chat</h2>
                <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="group relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 group-focus-within:text-[#00a884]" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search username or phone number"
                  className="w-full rounded-lg bg-[#f0f2f5] py-2.5 pl-11 pr-10 text-[#111b21] placeholder:text-[#667781] outline-none"
                />
                {loading && <LoaderCircle className="absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-[#00a884]" />}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {!searchable ? (
                <div className="space-y-3 px-6 py-8 text-sm text-slate-500">
                  <p className="flex items-center gap-2"><AtSign className="h-4 w-4 text-[#00a884]" /> Type at least 2 letters of a username</p>
                  <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-[#00a884]" /> or a full phone number with country code, e.g. +91 98765 43210</p>
                </div>
              ) : error ? (
                <div className="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
              ) : shown && shown.length === 0 ? (
                <div className="px-6 py-10 text-center text-slate-500">
                  <UserX className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                  {phoneSearch ? "No account with that phone number" : "No users found"}
                </div>
              ) : (
                <ul className="py-1">
                  {shown?.map((u) => (
                    <li key={u.id}>
                      <button onClick={() => setSelected(u)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[#f5f6f6]">
                        <Avatar name={u.name} image={u.profileImage} seed={u.id} className="h-11 w-11 text-sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-900">
                            {u.name}
                            {u.id === myId && <span className="font-normal text-slate-500"> (You)</span>}
                          </p>
                          <p className="truncate text-sm text-slate-500">@{u.username}{u.phone ? ` · ${u.phone}` : ""}</p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

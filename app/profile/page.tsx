"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  AtSign,
  Calendar,
  Camera,
  Check,
  Copy,
  Fingerprint,
  LoaderCircle,
  LogOut,
  Mail,
  Phone,
  Trash2,
  User as UserIcon,
} from "lucide-react";
import Avatar from "@/components/Avatar";
import AuthInput from "@/components/auth/AuthInput";
import { useCurrentUser } from "@/components/auth/useCurrentUser";
import { ApiError, removeProfilePhoto, updateProfile, uploadProfilePhoto } from "@/services/auth";

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export default function ProfilePage() {
  const { token, user, setUser, logout, endSession } = useCurrentUser();
  const fileInput = useRef<HTMLInputElement>(null);

  // null = untouched (show the saved value)
  const [name, setName] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  if (!user) {
    return (
      <div className="min-h-screen w-full bg-slate-950 flex items-center justify-center">
        <LoaderCircle className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  const nameValue = name ?? user.name;
  const usernameValue = username ?? user.username ?? "";
  const phoneValue = phone ?? user.phone ?? "";

  // Only send fields that actually changed.
  const changes: { name?: string; username?: string; phone?: string | null } = {};
  if (nameValue.trim() && nameValue.trim() !== user.name) changes.name = nameValue.trim();
  const cleanUsername = usernameValue.trim().replace(/^@/, "").toLowerCase();
  if (cleanUsername && cleanUsername !== user.username) changes.username = cleanUsername;
  if (phoneValue.trim() !== (user.phone ?? "")) changes.phone = phoneValue.trim() || null;
  const hasChanges = Object.keys(changes).length > 0;

  function handleError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) return endSession();
    setNotice({ type: "error", text: error instanceof Error ? error.message : "Something went wrong" });
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!hasChanges) return;
    setSaving(true);
    setNotice(null);
    try {
      setUser(await updateProfile(token, changes));
      setName(null);
      setUsername(null);
      setPhone(null);
      setNotice({ type: "success", text: "Profile updated" });
    } catch (error) {
      handleError(error);
    } finally {
      setSaving(false);
    }
  }

  async function handlePhotoChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow choosing the same file again
    if (!file) return;

    if (file.size > MAX_PHOTO_BYTES) {
      setNotice({ type: "error", text: "Image must be 2 MB or smaller" });
      return;
    }

    setPhotoBusy(true);
    setNotice(null);
    try {
      setUser(await uploadProfilePhoto(token, file));
      setNotice({ type: "success", text: "Profile photo updated" });
    } catch (error) {
      handleError(error);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleRemovePhoto() {
    setPhotoBusy(true);
    setNotice(null);
    try {
      setUser(await removeProfilePhoto(token));
      setNotice({ type: "success", text: "Profile photo removed" });
    } catch (error) {
      handleError(error);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleCopyId() {
    await navigator.clipboard.writeText(user!.id).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="min-h-screen w-full bg-slate-950 text-slate-900 flex items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-40 -left-40 h-[28rem] w-[28rem] rounded-full bg-emerald-500/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[28rem] w-[28rem] rounded-full bg-teal-400/20 blur-3xl" />

      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl shadow-black/40 ring-1 ring-white/10">
        {/* Cover + avatar */}
        <div className="relative h-32 bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700">
          <Link
            href="/"
            className="absolute left-4 top-4 flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium text-white backdrop-blur hover:bg-white/25"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to chat
          </Link>
        </div>

        <div className="px-6 pb-8 sm:px-10">
          <div className="-mt-14 flex flex-col items-center text-center">
            <div className="relative">
              <Avatar
                name={user.name}
                image={user.profileImage}
                seed={user.id}
                className="h-28 w-28 text-3xl ring-4 ring-white shadow-lg"
              />
              {photoBusy && (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
                  <LoaderCircle className="h-7 w-7 animate-spin text-white" />
                </div>
              )}
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={photoBusy}
                className="absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white shadow-md ring-4 ring-white transition hover:bg-emerald-700 disabled:opacity-60"
                aria-label="Change profile photo"
              >
                <Camera className="h-4 w-4" />
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handlePhotoChosen}
                className="hidden"
              />
            </div>

            <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">{user.name}</h1>
            {user.username && <p className="text-sm font-medium text-emerald-700">@{user.username}</p>}
            <p className="text-sm text-slate-500">{user.email}</p>

            {user.profileImage && (
              <button
                type="button"
                onClick={handleRemovePhoto}
                disabled={photoBusy}
                className="mt-3 flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-red-600 disabled:opacity-60"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove photo
              </button>
            )}
          </div>

          {notice && (
            <div
              className={`mt-6 rounded-xl border px-4 py-3 text-sm ${
                notice.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {notice.text}
            </div>
          )}

          {/* Edit name, username, phone */}
          <form onSubmit={handleSaveProfile} className="mt-6 space-y-4">
            <AuthInput
              label="Display name"
              icon={UserIcon}
              placeholder="Your name"
              maxLength={50}
              value={nameValue}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <div className="space-y-1">
              <AuthInput
                label="Username"
                icon={AtSign}
                placeholder="john_doe"
                autoCapitalize="none"
                spellCheck={false}
                value={usernameValue}
                onChange={(e) => setUsername(e.target.value)}
                pattern="@?[A-Za-z0-9_]{3,20}"
                title="3-20 letters, numbers or underscores"
                required
              />
              <p className="text-xs text-slate-500">People can find you by searching this</p>
            </div>
            <div className="space-y-1">
              <AuthInput
                label="Phone number (optional)"
                icon={Phone}
                type="tel"
                placeholder="+91 98765 43210"
                value={phoneValue}
                onChange={(e) => setPhone(e.target.value)}
              />
              <p className="text-xs text-slate-500">Include your country code · clear the box to remove it</p>
            </div>
            <button
              type="submit"
              disabled={!hasChanges || saving}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 py-3 font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {saving ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
              {saving ? "Saving..." : "Save changes"}
            </button>
          </form>

          {/* Account details */}
          <dl className="mt-8 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-slate-50">
            <div className="flex items-center gap-3 px-4 py-3">
              <Mail className="h-4 w-4 shrink-0 text-slate-400" />
              <dt className="w-24 shrink-0 text-sm text-slate-500">Email</dt>
              <dd className="min-w-0 truncate text-sm font-medium text-slate-800">{user.email}</dd>
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <Fingerprint className="h-4 w-4 shrink-0 text-slate-400" />
              <dt className="w-24 shrink-0 text-sm text-slate-500">User ID</dt>
              <dd className="flex min-w-0 flex-1 items-center gap-2">
                <code className="min-w-0 truncate font-mono text-xs text-slate-800">{user.id}</code>
                <button
                  type="button"
                  onClick={handleCopyId}
                  className="ml-auto shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                  aria-label="Copy user ID"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </button>
              </dd>
            </div>
            {user.createdAt && (
              <div className="flex items-center gap-3 px-4 py-3">
                <Calendar className="h-4 w-4 shrink-0 text-slate-400" />
                <dt className="w-24 shrink-0 text-sm text-slate-500">Joined</dt>
                <dd className="text-sm font-medium text-slate-800">
                  {new Date(user.createdAt).toLocaleDateString(undefined, { dateStyle: "long" })}
                </dd>
              </div>
            )}
          </dl>

          <button
            type="button"
            onClick={async () => {
              setLoggingOut(true);
              await logout();
            }}
            disabled={loggingOut}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 py-3 font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-60"
          >
            {loggingOut ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <LogOut className="h-5 w-5" />}
            Log out
          </button>
        </div>
      </div>
    </main>
  );
}

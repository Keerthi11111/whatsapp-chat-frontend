"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, AtSign, LoaderCircle, Lock, Mail, Phone, User } from "lucide-react";
import { registerUser } from "@/services/auth";
import AuthShell from "@/components/auth/AuthShell";
import AuthInput from "@/components/auth/AuthInput";

export default function RegisterPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await registerUser({
        name,
        username,
        ...(phone.trim() ? { phone } : {}),
        email,
        password,
      });

      alert("Registration successful! Please login.");
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  const strength = Math.min(
    4,
    (password.length >= 8 ? 1 : 0) +
      (/[A-Z]/.test(password) ? 1 : 0) +
      (/\d/.test(password) ? 1 : 0) +
      (/[^A-Za-z0-9]/.test(password) ? 1 : 0)
  );
  const strengthColors = ["bg-slate-200", "bg-red-500", "bg-amber-500", "bg-lime-500", "bg-emerald-500"];
  const strengthLabels = ["", "Weak", "Fair", "Good", "Strong"];

  return (
    <AuthShell title="Create your account" subtitle="Join in seconds and start chatting.">
      <form onSubmit={handleRegister} className="space-y-4">
        <AuthInput
          label="Full name"
          icon={User}
          placeholder="John Doe"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <div className="space-y-1">
          <AuthInput
            label="Username"
            icon={AtSign}
            placeholder="john_doe"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            pattern="@?[A-Za-z0-9_]{3,20}"
            title="3-20 letters, numbers or underscores"
            required
          />
          <p className="text-xs text-slate-500">3-20 letters, numbers or _ · people can find you by this</p>
        </div>

        <div className="space-y-1">
          <AuthInput
            label="Phone number (optional)"
            icon={Phone}
            type="tel"
            placeholder="+91 98765 43210"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <p className="text-xs text-slate-500">Include your country code, e.g. +91</p>
        </div>

        <AuthInput
          label="Email address"
          icon={Mail}
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <div className="space-y-2">
          <AuthInput
            label="Password"
            icon={Lock}
            type="password"
            placeholder="Minimum 8 characters"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          {password && (
            <div className="flex items-center gap-3">
              <div className="flex flex-1 gap-1.5">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full transition-colors ${
                      i <= strength ? strengthColors[strength] : "bg-slate-200"
                    }`}
                  />
                ))}
              </div>
              <span className="w-12 text-right text-xs font-medium text-slate-500">
                {strengthLabels[strength]}
              </span>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 py-3.5 font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:shadow-emerald-500/50 hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <>
              <LoaderCircle className="h-5 w-5 animate-spin" />
              Creating account...
            </>
          ) : (
            <>
              Create account
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>

        <p className="pt-2 text-center text-sm text-slate-600">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-emerald-600 hover:text-emerald-700 hover:underline">
            Log in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

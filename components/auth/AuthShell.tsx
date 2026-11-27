import { MessageCircle, ShieldCheck } from "lucide-react";

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: React.ReactNode;
};

export default function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <main className="min-h-screen w-full bg-slate-950 text-slate-900 flex items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      {/* Background glow */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-[28rem] w-[28rem] rounded-full bg-emerald-500/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[28rem] w-[28rem] rounded-full bg-teal-400/20 blur-3xl" />

      <div className="relative w-full max-w-5xl grid lg:grid-cols-2 rounded-3xl overflow-hidden shadow-2xl shadow-black/40 ring-1 ring-white/10">
        {/* Brand panel */}
        <section className="hidden lg:flex flex-col justify-between bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 p-10 text-white">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center">
              <MessageCircle className="h-6 w-6" />
            </div>
            <span className="text-xl font-semibold tracking-tight">ChatApp</span>
          </div>

          {/* Mock conversation */}
          <div className="space-y-3">
            <div className="max-w-[75%] rounded-2xl rounded-tl-sm bg-white/95 px-4 py-2.5 text-sm text-slate-800 shadow-lg">
              Hey! Are you joining the call later? 👋
            </div>
            <div className="ml-auto max-w-[75%] rounded-2xl rounded-tr-sm bg-emerald-900/60 px-4 py-2.5 text-sm text-white shadow-lg">
              Yes, see you at 5!
              <span className="ml-2 text-[10px] text-emerald-200">✓✓</span>
            </div>
            <div className="max-w-[60%] rounded-2xl rounded-tl-sm bg-white/95 px-4 py-2.5 text-sm text-slate-800 shadow-lg">
              Perfect 🎉
            </div>
          </div>

          <div>
            <h2 className="text-3xl font-bold leading-tight">
              Stay connected with
              <br />
              the people who matter.
            </h2>
            <p className="mt-3 flex items-center gap-2 text-emerald-50/90 text-sm">
              <ShieldCheck className="h-4 w-4" />
              Fast, simple and secure messaging.
            </p>
          </div>
        </section>

        {/* Form panel */}
        <section className="bg-white px-6 py-10 sm:px-12 sm:py-14 flex flex-col justify-center">
          <div className="lg:hidden mb-8 flex items-center justify-center gap-2">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center">
              <MessageCircle className="h-5 w-5" />
            </div>
            <span className="text-lg font-semibold text-slate-900">ChatApp</span>
          </div>

          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
            <p className="mt-2 text-slate-500">{subtitle}</p>
          </div>

          {children}
        </section>
      </div>
    </main>
  );
}

import AuthGuard from "@/components/auth/AuthGuard";

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard mode="guest">{children}</AuthGuard>;
}

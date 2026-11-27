import AuthGuard from "@/components/auth/AuthGuard";

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard mode="guest">{children}</AuthGuard>;
}

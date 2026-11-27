import ChatWindow from "@/components/chat/ChatWindow";
import AuthGuard from "@/components/auth/AuthGuard";

export default function Home() {
  return (
    <AuthGuard mode="protected">
      <ChatWindow />
    </AuthGuard>
  );
}

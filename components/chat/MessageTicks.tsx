import { Check, CheckCheck, CircleAlert, Clock } from "lucide-react";
import type { DisplayMessage } from "./types";

/** Blue of WhatsApp's "read" ticks. */
export const READ_BLUE = "text-[#53bdeb]";

const LABELS = { sending: "Sending", failed: "Not sent", sent: "Sent", delivered: "Delivered", read: "Read" };

/**
 * WhatsApp ticks for a message I sent:
 *   🕓 sending · ✓ sent · ✓✓ delivered · blue ✓✓ read · ⚠ not sent
 */
export default function MessageTicks({ message, className = "h-4 w-4" }: { message: DisplayMessage; className?: string }) {
  const state = message.sendState ?? message.status ?? "sent";
  const label = LABELS[state];

  switch (state) {
    case "sending":
      return <Clock className={`${className} scale-[0.8]`} aria-label={label} />;
    case "failed":
      return <CircleAlert className={`${className} text-red-500`} aria-label={label} />;
    case "read":
      return <CheckCheck className={`${className} ${READ_BLUE}`} aria-label={label} />;
    case "delivered":
      return <CheckCheck className={className} aria-label={label} />;
    default:
      return <Check className={className} aria-label={label} />;
  }
}

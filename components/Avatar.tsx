import { photoUrl } from "@/services/auth";

const COLORS = [
  "from-emerald-500 to-teal-600",
  "from-sky-500 to-indigo-600",
  "from-fuchsia-500 to-pink-600",
  "from-amber-500 to-orange-600",
  "from-violet-500 to-purple-600",
];

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "")).toUpperCase() || "?";
}

type AvatarProps = {
  name: string;
  image?: string | null;
  /** Tailwind size + text classes, e.g. "h-10 w-10 text-sm" */
  className?: string;
  /** Used to pick a stable color, usually the user ID. */
  seed?: string;
};

export default function Avatar({ name, image, className = "h-10 w-10 text-sm", seed = name }: AvatarProps) {
  const src = photoUrl(image);
  const color = COLORS[[...seed].reduce((sum, c) => sum + c.charCodeAt(0), 0) % COLORS.length];

  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- photos come from our backend, not optimizable by next/image config
    return <img src={src} alt={name} className={`${className} shrink-0 rounded-full object-cover`} />;
  }

  return (
    <div className={`${className} shrink-0 rounded-full bg-gradient-to-br ${color} flex items-center justify-center font-semibold text-white select-none`}>
      {initials(name)}
    </div>
  );
}

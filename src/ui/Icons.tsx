/** One icon set for the whole app: 24 grid, round ends, same stroke weight everywhere. */

export type IconName = "move" | "frame" | "rect" | "ellipse" | "text" | "hand" | "image" | "pen" | "group" | "lock" | "unlock";

const PATHS: Record<IconName, React.ReactNode> = {
  move: <path d="M5.5 3.5l13 6.3-5.7 1.8-1.8 5.9z" />,
  frame: <path d="M8 3v18M16 3v18M3 8h18M3 16h18" />,
  rect: <rect x="4" y="5" width="16" height="14" rx="2.5" />,
  ellipse: <circle cx="12" cy="12" r="8" />,
  text: <path d="M5.5 7V5.5h13V7M12 5.5v13M9 18.5h6" />,
  group: (
    <>
      <path d="M4 8V5.5A1.5 1.5 0 015.5 4H8M16 4h2.5A1.5 1.5 0 0120 5.5V8M20 16v2.5a1.5 1.5 0 01-1.5 1.5H16M8 20H5.5A1.5 1.5 0 014 18.5V16" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </>
  ),
  lock: (
    <>
      <rect x="6" y="11" width="12" height="8.5" rx="2" />
      <path d="M8.5 11V8.5a3.5 3.5 0 017 0V11" />
    </>
  ),
  unlock: (
    <>
      <rect x="6" y="11" width="12" height="8.5" rx="2" />
      <path d="M8.5 11V8.5a3.5 3.5 0 016.6-1.6" />
    </>
  ),
  pen: <path d="M12 3.5l4.5 4.5-9 10.5-3.5.5.5-3.5zM14.5 6.5l3 3M12 12l-2.5-2.5" />,
  image: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M4.5 17l4.5-4.5 3 3 2.5-2.5 5 5" />
    </>
  ),
  hand: <path d="M8 12.5V6.5a1.5 1.5 0 013 0V11m0-1.5V5a1.5 1.5 0 013 0v6m0-3.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1.2a6 6 0 01-4.8-2.4L4.6 15a1.5 1.5 0 012.3-1.9L8 14.5" />,
};

export default function Icon({ name, size = 17, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}

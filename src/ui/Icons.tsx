/** One icon set for the whole app: 24 grid, round ends, same stroke weight everywhere. */

export type IconName = "move" | "frame" | "rect" | "ellipse" | "text" | "hand" | "image";

const PATHS: Record<IconName, React.ReactNode> = {
  move: <path d="M5.5 3.5l13 6.3-5.7 1.8-1.8 5.9z" />,
  frame: <path d="M8 3v18M16 3v18M3 8h18M3 16h18" />,
  rect: <rect x="4" y="5" width="16" height="14" rx="2.5" />,
  ellipse: <circle cx="12" cy="12" r="8" />,
  text: <path d="M5.5 7V5.5h13V7M12 5.5v13M9 18.5h6" />,
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

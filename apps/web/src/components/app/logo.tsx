export function Logo({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path d="M9 23V9h13v3.2h-9.4v2.6h8.2V18h-8.2v5z" fill="white" />
      <circle cx="23" cy="21.5" r="2.6" fill="white" />
    </svg>
  );
}

import { Link } from "@tanstack/react-router";

export function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-full bg-wine font-display text-lg text-gold">
        H
      </span>
      <div className="leading-none">
        <div className="text-sm font-semibold tracking-tight">Hearth</div>
        <div className="mt-0.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          For a lifetime
        </div>
      </div>
    </Link>
  );
}

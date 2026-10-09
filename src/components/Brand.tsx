import { Link } from "@tanstack/react-router";

export function Brand({ product = "Hearth" }: { product?: "Hearth" | "Heimdall" }) {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-full bg-wine font-display text-lg text-gold">
        H
      </span>
      <div className="leading-none">
        <div className="text-sm font-semibold tracking-tight">{product}</div>
        <div className="mt-0.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {product === "Heimdall" ? "Your private screening profile" : "For a lifetime"}
        </div>
      </div>
    </Link>
  );
}

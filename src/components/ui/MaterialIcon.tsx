import { cn } from "@/lib/utils";

type MaterialIconProps = {
  name: string;
  filled?: boolean;
  className?: string;
  size?: number;
  /** Accessible label; omit for decorative icons */
  label?: string;
};

/**
 * Material Symbols Outlined — exclusive icon set for GrowwMatics AI.
 * Use `filled` for active/selected nav states.
 */
export function MaterialIcon({
  name,
  filled = false,
  className,
  size,
  label,
}: MaterialIconProps) {
  return (
    <span
      className={cn(
        "material-symbols-outlined shrink-0",
        filled && "filled",
        className
      )}
      style={size ? { fontSize: size } : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
    >
      {name}
    </span>
  );
}

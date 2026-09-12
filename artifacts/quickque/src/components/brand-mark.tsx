import { cn } from "@/lib/utils";

interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logo.svg`}
      alt=""
      aria-hidden="true"
      className={cn("object-contain", className)}
    />
  );
}
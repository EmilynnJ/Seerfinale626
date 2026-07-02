import React from "react";
import { Star } from "lucide-react";

export default function Stars({ value = 0, size = 14, onChange }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          data-testid={onChange ? `star-${i}` : undefined}
          className={`${i <= Math.round(value) ? "fill-gold text-gold" : "text-white/25"} ${onChange ? "cursor-pointer" : ""}`}
          onClick={onChange ? () => onChange(i) : undefined}
        />
      ))}
    </span>
  );
}

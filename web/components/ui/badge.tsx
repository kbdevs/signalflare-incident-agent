import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex min-h-6 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium tabular-nums",
  {
    variants: {
      variant: {
        default: "bg-foreground text-background",
        secondary: "bg-muted text-muted-foreground",
        outline: "text-muted-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]",
      },
    },
    defaultVariants: { variant: "secondary" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

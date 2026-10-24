// SPDX-License-Identifier: AGPL-3.0-or-later
// Text in the React Native Reusables pattern: variants by class, tabular
// figures for numbers so counters do not jump.
import { cva, type VariantProps } from "class-variance-authority";
import { Text as RNText, type TextProps } from "react-native";
import { cn } from "@/lib/utils";

const textVariants = cva("text-text font-inter", {
  variants: {
    variant: {
      body: "text-base",
      muted: "text-base text-text-muted",
      title: "text-2xl font-inter-semibold",
      heading: "text-xl font-inter-semibold",
      label: "text-sm font-inter-medium text-text-muted",
      number: "text-5xl font-inter-semibold",
    },
  },
  defaultVariants: { variant: "body" },
});

export type TextVariantProps = VariantProps<typeof textVariants>;

export function Text({
  className,
  variant,
  style,
  ...props
}: TextProps & TextVariantProps & { className?: string }) {
  return (
    <RNText
      className={cn(textVariants({ variant }), className)}
      style={[variant === "number" ? { fontVariant: ["tabular-nums"] } : undefined, style]}
      {...props}
    />
  );
}

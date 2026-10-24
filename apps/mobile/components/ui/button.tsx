// SPDX-License-Identifier: AGPL-3.0-or-later
// Button in the React Native Reusables pattern. Feedback starts on touch-down
// (onPressIn), not on release.
import { cva, type VariantProps } from "class-variance-authority";
import * as Haptics from "expo-haptics";
import { Pressable, type PressableProps } from "react-native";
import { cn } from "@/lib/utils";
import { Text } from "./text";

const buttonVariants = cva("flex-row items-center justify-center rounded-lg px-5 active:opacity-80", {
  variants: {
    variant: {
      primary: "bg-accent",
      secondary: "bg-surface-raised border border-border",
      ghost: "bg-transparent",
    },
    size: { md: "h-12", lg: "h-16" },
  },
  defaultVariants: { variant: "primary", size: "md" },
});

const labelVariants = cva("text-base font-inter-semibold", {
  variants: {
    variant: { primary: "text-accent-text", secondary: "text-text", ghost: "text-accent" },
  },
  defaultVariants: { variant: "primary" },
});

type Props = Omit<PressableProps, "children"> &
  VariantProps<typeof buttonVariants> & { label: string; className?: string };

export function Button({ label, variant, size, className, onPressIn, ...props }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      className={cn(buttonVariants({ variant, size }), className)}
      onPressIn={(e) => {
        void Haptics.selectionAsync();
        onPressIn?.(e);
      }}
      {...props}
    >
      <Text className={labelVariants({ variant })}>{label}</Text>
    </Pressable>
  );
}

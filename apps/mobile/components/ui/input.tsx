// SPDX-License-Identifier: AGPL-3.0-or-later
// Text field in the React Native Reusables pattern.
import { TextInput, type TextInputProps } from "react-native";
import { useTokens } from "@/features/theme/use-tokens";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: TextInputProps & { className?: string }) {
  const { color } = useTokens();
  return (
    <TextInput
      className={cn(
        "h-12 rounded-lg border border-border bg-surface px-4 font-inter text-base text-text",
        className,
      )}
      placeholderTextColor={color["text-muted"]}
      {...props}
    />
  );
}

import { ActivityIndicator, Pressable, Text, type PressableProps } from "react-native";

type Variant = "primary" | "secondary" | "destructive" | "ghost";
type Size = "md" | "sm";

type Props = Omit<PressableProps, "children"> & {
  label: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

const containerByVariant: Record<Variant, string> = {
  primary: "bg-black dark:bg-white",
  secondary: "border border-gray-300 dark:border-gray-700",
  destructive: "border border-red-500",
  ghost: "",
};

const labelByVariant: Record<Variant, string> = {
  primary: "text-white dark:text-black",
  secondary: "text-black dark:text-white",
  destructive: "text-red-500",
  ghost: "text-black dark:text-white",
};

const containerBySize: Record<Size, string> = {
  md: "py-3 px-4",
  sm: "py-2 px-3",
};

const labelBySize: Record<Size, string> = {
  md: "text-base",
  sm: "text-sm",
};

export function Button({
  label,
  variant = "primary",
  size = "md",
  loading,
  disabled,
  ...rest
}: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      {...rest}
      className={`flex-row items-center justify-center rounded-lg ${containerByVariant[variant]} ${containerBySize[size]} ${isDisabled ? "opacity-50" : ""}`}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? "#fff" : "#000"} />
      ) : (
        <Text className={`font-medium ${labelByVariant[variant]} ${labelBySize[size]}`}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

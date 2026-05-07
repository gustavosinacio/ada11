import { forwardRef } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";

type Props = TextInputProps & {
  label?: string;
  error?: string;
};

export const Textarea = forwardRef<TextInput, Props>(function Textarea(
  { label, error, ...rest },
  ref,
) {
  return (
    <View className="mb-3">
      {label ? (
        <Text className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        placeholderTextColor="#9ca3af"
        {...rest}
        className={`min-h-24 rounded-lg border px-4 py-3 text-base text-black dark:text-white ${
          error
            ? "border-red-500"
            : "border-gray-300 dark:border-gray-700"
        }`}
      />
      {error ? <Text className="mt-1 text-sm text-red-500">{error}</Text> : null}
    </View>
  );
});

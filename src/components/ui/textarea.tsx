import { forwardRef, useState } from "react";
import {
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
  type TextInputProps,
} from "react-native";

type Props = TextInputProps & {
  label?: string;
  error?: string;
  /**
   * When true, the field starts at a single line and grows to fit its content
   * (tracked via `onContentSizeChange`) instead of rendering a fixed-height
   * multi-line box. Used by the exercise-note slot so a one-line note isn't
   * shown inside a tall empty box.
   */
  autoGrow?: boolean;
};

// ~one line of `text-base` plus the `py-3` vertical padding. Floors the
// auto-grow height so an empty / single-line field still reads as an input.
const AUTO_GROW_MIN_HEIGHT = 44;

export const Textarea = forwardRef<TextInput, Props>(function Textarea(
  { label, error, autoGrow = false, onContentSizeChange, style, ...rest },
  ref,
) {
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  const handleContentSizeChange = (
    e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>,
  ) => {
    if (autoGrow) setContentHeight(e.nativeEvent.contentSize.height);
    onContentSizeChange?.(e);
  };

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
        numberOfLines={autoGrow ? undefined : 4}
        textAlignVertical="top"
        placeholderTextColor="#9ca3af"
        onContentSizeChange={handleContentSizeChange}
        {...rest}
        className={`rounded-lg border px-4 py-3 text-base text-black dark:text-white ${
          autoGrow ? "" : "min-h-24"
        } ${
          error
            ? "border-red-500"
            : "border-gray-300 dark:border-gray-700"
        }`}
        style={
          autoGrow
            ? [
                {
                  minHeight: AUTO_GROW_MIN_HEIGHT,
                  height: contentHeight ?? AUTO_GROW_MIN_HEIGHT,
                },
                style,
              ]
            : style
        }
      />
      {error ? <Text className="mt-1 text-sm text-red-500">{error}</Text> : null}
    </View>
  );
});

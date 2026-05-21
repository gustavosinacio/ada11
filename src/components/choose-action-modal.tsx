import { Modal, Pressable, Text, View } from "react-native";

export type ChooseActionVariant = "default" | "primary" | "destructive";

export type ChooseActionButton = {
  /** Display label. Also used verbatim as accessibilityLabel — e2e specs
   *  select via getByLabel(label). */
  label: string;
  /** Visual treatment. */
  variant?: ChooseActionVariant;
  onPress: () => void;
};

type Props = {
  visible: boolean;
  title: string;
  message?: string;
  buttons: ChooseActionButton[];
  /** Called when the user dismisses the modal without picking (backdrop tap
   *  or hardware back). Defaults to no-op. */
  onClose?: () => void;
};

const VARIANT_CLASSES: Record<ChooseActionVariant, string> = {
  primary:
    "bg-black dark:bg-white border border-black dark:border-white",
  destructive:
    "bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900",
  default:
    "bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700",
};

const VARIANT_TEXT: Record<ChooseActionVariant, string> = {
  primary: "text-white dark:text-black",
  destructive: "text-red-600 dark:text-red-400",
  default: "text-black dark:text-white",
};

/**
 * Cross-platform N-option dialog. React Native <Modal> works on iOS, Android,
 * and web (React Native Web). Each button carries its label as
 * accessibilityLabel — e2e selectors are page.getByLabel("...").
 *
 * Button order is rendered top-to-bottom in the order passed in. iOS HIG
 * vertical-stack convention is: primary on top, destructive in the middle,
 * cancel at the bottom.
 */
export function ChooseActionModal({
  visible,
  title,
  message,
  buttons,
  onClose,
}: Props) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        accessibilityLabel="Dismiss dialog"
        className="flex-1 items-center justify-center bg-black/40 px-6"
      >
        {/* Card. Inner Pressable blocks the backdrop dismiss when tapping
            anywhere inside the card. */}
        <Pressable
          onPress={() => {
            // no-op; just absorb the tap so the backdrop doesn't dismiss.
          }}
          className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-gray-900"
        >
          <Text className="text-center text-base font-semibold text-black dark:text-white">
            {title}
          </Text>
          {message ? (
            <Text className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
              {message}
            </Text>
          ) : null}

          <View className="mt-5 gap-2">
            {buttons.map((btn) => {
              const variant: ChooseActionVariant = btn.variant ?? "default";
              return (
                <Pressable
                  key={btn.label}
                  onPress={btn.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={btn.label}
                  className={`min-h-11 items-center justify-center rounded-lg px-4 py-3 ${VARIANT_CLASSES[variant]}`}
                >
                  <Text
                    className={`text-center text-sm font-medium ${VARIANT_TEXT[variant]}`}
                  >
                    {btn.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

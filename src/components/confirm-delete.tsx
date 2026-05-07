import { Alert, Platform } from "react-native";

type Options = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

/**
 * Cross-platform delete confirm. Uses window.confirm on web because
 * React Native's Alert isn't available there.
 */
export function confirmDelete(opts: Options): Promise<boolean> {
  const {
    title,
    message,
    confirmLabel = "Delete",
    cancelLabel = "Cancel",
  } = opts;

  if (Platform.OS === "web") {
    const ok =
      typeof window !== "undefined"
        ? window.confirm(message ? `${title}\n\n${message}` : title)
        : false;
    return Promise.resolve(ok);
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: "cancel", onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: "destructive",
        onPress: () => resolve(true),
      },
    ]);
  });
}

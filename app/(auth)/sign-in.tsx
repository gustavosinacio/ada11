import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, Text, TextInput, View } from "react-native";
import { z } from "zod";

import { supabase } from "~/lib/supabase";

const credentialsSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type Credentials = z.infer<typeof credentialsSchema>;

type Banner = { kind: "error" | "info"; message: string };

export default function SignInScreen() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<Credentials>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: Credentials) => {
    setSubmitting(true);
    setBanner(null);
    try {
      const { data, error } =
        mode === "sign-in"
          ? await supabase.auth.signInWithPassword(values)
          : await supabase.auth.signUp(values);
      if (error) {
        setBanner({ kind: "error", message: error.message });
      } else if (mode === "sign-up" && !data.session) {
        // Sign-up with email confirmation enabled — no session yet.
        setBanner({
          kind: "info",
          message: "Check your email to confirm your address, then sign in.",
        });
      }
      // If sign-in succeeds (or sign-up with confirmation off), AuthGate handles the redirect.
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogle = async () => {
    setBanner({
      kind: "info",
      message: "Google sign-in is coming once OAuth credentials are configured.",
    });
  };

  const onApple = async () => {
    setBanner({
      kind: "info",
      message: "Apple sign-in is coming once Apple Developer is set up.",
    });
  };

  return (
    <View className="flex-1 items-stretch justify-center bg-white px-6 dark:bg-black">
      <Text className="mb-8 text-center text-3xl font-semibold text-black dark:text-white">
        {mode === "sign-in" ? "Sign in" : "Create account"}
      </Text>

      {banner ? (
        <View
          accessibilityRole="alert"
          className={
            banner.kind === "error"
              ? "mb-4 rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950"
              : "mb-4 rounded-lg border border-blue-300 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950"
          }
        >
          <Text
            className={
              banner.kind === "error"
                ? "text-sm text-red-700 dark:text-red-300"
                : "text-sm text-blue-700 dark:text-blue-300"
            }
          >
            {banner.message}
          </Text>
        </View>
      ) : null}

      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, value } }) => (
          <TextInput
            placeholder="Email"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={value}
            onChangeText={onChange}
            className="mb-2 rounded-lg border border-gray-300 px-4 py-3 text-base text-black dark:border-gray-700 dark:text-white"
            placeholderTextColor="#9ca3af"
          />
        )}
      />
      {errors.email ? (
        <Text className="mb-2 text-sm text-red-500">{errors.email.message}</Text>
      ) : null}

      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, value } }) => (
          <TextInput
            placeholder="Password"
            secureTextEntry
            autoCapitalize="none"
            value={value}
            onChangeText={onChange}
            className="mb-2 rounded-lg border border-gray-300 px-4 py-3 text-base text-black dark:border-gray-700 dark:text-white"
            placeholderTextColor="#9ca3af"
          />
        )}
      />
      {errors.password ? (
        <Text className="mb-2 text-sm text-red-500">{errors.password.message}</Text>
      ) : null}

      <Pressable
        onPress={handleSubmit(onSubmit)}
        disabled={submitting}
        accessibilityRole="button"
        testID="auth-submit"
        className="mt-2 rounded-lg bg-black py-3 dark:bg-white"
      >
        <Text className="text-center text-base font-medium text-white dark:text-black">
          {submitting ? "..." : mode === "sign-in" ? "Sign in" : "Create account"}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => {
          setMode((m) => (m === "sign-in" ? "sign-up" : "sign-in"));
          setBanner(null);
        }}
        accessibilityRole="button"
        testID="auth-mode-toggle"
        className="mt-3 py-2"
      >
        <Text className="text-center text-sm text-gray-500">
          {mode === "sign-in"
            ? "No account? Create one."
            : "Already have an account? Sign in."}
        </Text>
      </Pressable>

      <View className="my-6 h-px bg-gray-200 dark:bg-gray-800" />

      <Pressable
        onPress={onGoogle}
        accessibilityRole="button"
        testID="auth-google"
        className="mb-3 rounded-lg border border-gray-300 py-3 dark:border-gray-700"
      >
        <Text className="text-center text-base text-black dark:text-white">
          Continue with Google
        </Text>
      </Pressable>

      <Pressable
        onPress={onApple}
        accessibilityRole="button"
        testID="auth-apple"
        className="rounded-lg border border-gray-300 py-3 dark:border-gray-700"
      >
        <Text className="text-center text-base text-black dark:text-white">
          Continue with Apple
        </Text>
      </Pressable>
    </View>
  );
}

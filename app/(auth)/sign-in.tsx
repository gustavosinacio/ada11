import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { z } from "zod";

import { supabase } from "~/lib/supabase";

const credentialsSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type Credentials = z.infer<typeof credentialsSchema>;

export default function SignInScreen() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [submitting, setSubmitting] = useState(false);

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
    try {
      const { error } =
        mode === "sign-in"
          ? await supabase.auth.signInWithPassword(values)
          : await supabase.auth.signUp(values);
      if (error) Alert.alert("Auth error", error.message);
      else if (mode === "sign-up")
        Alert.alert("Check your email", "Confirm your address to finish signing up.");
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogle = async () => {
    Alert.alert("Coming soon", "Google sign-in wiring lands once OAuth credentials are set.");
  };

  const onApple = async () => {
    Alert.alert("Coming soon", "Apple sign-in wiring lands once Apple Developer is configured.");
  };

  return (
    <View className="flex-1 items-stretch justify-center bg-white px-6 dark:bg-black">
      <Text className="mb-8 text-center text-3xl font-semibold text-black dark:text-white">
        {mode === "sign-in" ? "Sign in" : "Create account"}
      </Text>

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
        className="mt-2 rounded-lg bg-black py-3 dark:bg-white"
      >
        <Text className="text-center text-base font-medium text-white dark:text-black">
          {submitting ? "..." : mode === "sign-in" ? "Sign in" : "Create account"}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => setMode((m) => (m === "sign-in" ? "sign-up" : "sign-in"))}
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
        className="mb-3 rounded-lg border border-gray-300 py-3 dark:border-gray-700"
      >
        <Text className="text-center text-base text-black dark:text-white">
          Continue with Google
        </Text>
      </Pressable>

      <Pressable
        onPress={onApple}
        className="rounded-lg border border-gray-300 py-3 dark:border-gray-700"
      >
        <Text className="text-center text-base text-black dark:text-white">
          Continue with Apple
        </Text>
      </Pressable>
    </View>
  );
}

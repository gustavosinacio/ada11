import { Redirect } from "expo-router";

// Root path. The AuthGate in app/_layout.tsx will redirect to /(auth)/sign-in
// when there's no session, otherwise this lands on the Workout tab.
export default function Index() {
  return <Redirect href="/(app)/workout" />;
}

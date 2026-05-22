import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

// Customizes the static HTML head emitted by expo-router for web exports.
// theme-color tints iOS Safari's URL bar + bottom toolbar to match the app's
// background; without it, both default to white and look like a frame around
// the dark app content.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}

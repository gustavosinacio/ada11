import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      gcTime: 1000 * 60 * 60 * 24,
      retry: 2,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
    },
  },
});

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "ada11-query-cache",
});

// Bump when a schema change makes previously persisted query data
// incompatible with the current runtime (e.g. new required field added).
// The PersistQueryClientProvider invalidates persisted cache when this changes.
export const queryCacheBuster = "schema-2026-05-19-muscles";

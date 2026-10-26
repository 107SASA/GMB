import { Stack } from 'expo-router';

import { useTheme } from '@/lib/theme';

// posts/index.tsx is the tab itself (registered as the "posts" bottom tab in
// (app)/_layout.tsx); posts/[id].tsx and posts/create.tsx are pushed on top
// of it as stack screens — same pattern as audit/_layout.tsx.
export default function PostsLayout() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    />
  );
}

# Business Context Flow

## React Context Provider
To manage state across the entire UI without prop-drilling, we implemented `<BusinessProvider>` (`src/context/BusinessContext.tsx`).

### State Flow
1. User logs in. `NextAuth` returns `session.user.activeBusinessId`.
2. `<BusinessProvider>` mounts and calls `GET /api/user/businesses`.
3. The provider maps over the user's `businessIds` array.
4. The active business is stored in memory (`activeBusiness` state) and consumed across the dashboard via `useBusiness()`.

### The Business Switcher
Located in `Sidebar.tsx`, the `<select>` dropdown allows users to swap locations.
When triggered:
1. `setActiveBusinessId(newId)` updates the React Context.
2. `update({ activeBusinessId: newId })` pushes the new ID back into the NextAuth JWT session via the NextAuth `/api/auth/session` API.
3. `router.refresh()` forces the Next.js server components to re-render using the new context, instantly swapping the data displayed on the dashboard.

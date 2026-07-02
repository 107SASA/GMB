# Frontend Architecture

The frontend is a React application utilizing the Next.js App Router. It is heavily styled with TailwindCSS and Framer Motion for micro-interactions.

## 1. App Router Structure
All dashboard pages reside in `src/app/dashboard/`.
The primary layout is `src/app/dashboard/layout.tsx`.

## 2. Global State Management
The app uses React Context for global state, specifically the `BusinessContext` (`src/context/BusinessContext.tsx`).
- It wraps the `DashboardLayout`.
- It holds the currently selected `businessId` in state.
- This prevents "prop drilling" and allows any child page (like `/posts` or `/reviews`) to fetch data specific to the active business without hardcoding IDs in the API calls.

## 3. UI/UX Design Language
- **Glassmorphism**: Achieved using Tailwind utility combos like `bg-white/5 border border-white/10 backdrop-blur-xl`.
- **Dark Mode Default**: The entire app operates on a dark theme, utilizing a `bg-[#030014]` root background.
- **Animations**: `framer-motion` is used to animate page transitions (`AnimatePresence`), hover scales (`whileHover={{ scale: 1.05 }}`), and dynamic toast popups.

## 4. Key Libraries
- `@dnd-kit`: Used extensively in `/dashboard/crm` for the drag-and-drop Kanban pipeline. It provides a lightweight, accessible framework for sorting lists.
- `lucide-react`: The standard icon library across the entire platform.
- `react-hot-toast`: Used for all client-side success/error notification banners.

## 5. The CRM Kanban Board (`@dnd-kit`)
The CRM page (`src/app/dashboard/crm/page.tsx`) implements a horizontal lane structure.
1. It fetches leads from `/api/leads`.
2. It maps the leads into columns based on the Lead `status` enum (`New`, `Contacted`, etc.).
3. The `DndContext` wraps the lanes, tracking `onDragEnd` events.
4. When a card is dropped, it performs an **optimistic UI update** (instantly changing state visually) before attempting the backend PUT request, reverting if the request fails.

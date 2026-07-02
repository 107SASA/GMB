# Onboarding UI Guide

## Design System

### 1. Color Palette
The onboarding wizard departs from heavy, dark aesthetics and uses a premium, light-mode palette:
- **Background**: `#FAFAFA` (Off-white, ultra-clean)
- **Cards**: `bg-white` with `shadow-xl shadow-slate-200/50` for deep, soft elevation.
- **Accents**: Indigo/Primary for primary CTAs and progress bars.
- **Text**: `text-slate-900` for primary headings, `text-slate-500` for descriptions.

### 2. Layout Structure
- The wizard is vertically and horizontally centered.
- The interactive container is fixed at `max-w-2xl` and `h-[600px]`. This prevents the modal from jumping or shrinking as the user navigates between steps with varying amounts of content.

### 3. Iconography
We use `lucide-react` icons heavily. Each step features a distinct, colored icon block at the top left of the form to visually ground the user in the current task (e.g., a green MessageSquare for WhatsApp, a purple Layers icon for Modules).

### 4. Form Interactions
- Inputs use `bg-slate-50` and transition to `bg-white` with a `ring-2 ring-slate-900` focus state.
- Primary buttons feature a `hover:-translate-y-1` floating effect.

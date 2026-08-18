"use client";

import { useEffect, useMemo, useState } from "react";
import { Particles, ParticlesProvider } from "@tsparticles/react";
import type { ISourceOptions } from "@tsparticles/engine";
import { cn } from "@/lib/utils";
import { initSlimEngine } from "./particlesInit";

interface ParticleFieldProps {
  /** Unique per instance — the page can have more than one field (Hero, FinalCTA). */
  id: string;
  colors?: [string, string];
  /** Particle count. Keep low — this is ambient texture, not a toy. */
  density?: number;
  /** Max particle opacity. */
  opacity?: number;
  className?: string;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return reduced;
}

/**
 * Quiet, slow-drifting dot/line field used behind the Hero and FinalCTA
 * sections — the "living background" that replaces the static blurred-blob
 * divs those sections used to lean on. Deliberately restrained (low density,
 * low opacity, slow movement, no hover/click interaction) to fit the
 * premium-minimal direction rather than reading as a toy.
 *
 * Dynamically imported with `ssr: false` wherever it's used, and renders
 * nothing when the visitor has requested reduced motion.
 */
export function ParticleField({
  id,
  colors = ["#0a8a3e", "#62bd32"],
  density = 36,
  opacity = 0.35,
  className,
}: ParticleFieldProps) {
  const reducedMotion = useReducedMotion();

  const options: ISourceOptions = useMemo(
    () => ({
      fullScreen: { enable: false },
      fpsLimit: 60,
      detectRetina: true,
      background: { color: { value: "transparent" } },
      particles: {
        number: {
          value: density,
          density: { enable: true, width: 1600, height: 900 },
        },
        color: { value: colors },
        opacity: { value: { min: 0.08, max: opacity } },
        size: { value: { min: 1, max: 2.5 } },
        links: {
          enable: true,
          distance: 140,
          color: colors[0],
          opacity: 0.1,
          width: 1,
        },
        move: {
          enable: true,
          speed: 0.3,
          direction: "none",
          random: true,
          straight: false,
          outModes: { default: "out" },
        },
      },
      interactivity: {
        events: { onHover: { enable: false }, onClick: { enable: false } },
      },
    }),
    [colors, density, opacity]
  );

  if (reducedMotion) return null;

  return (
    <ParticlesProvider init={initSlimEngine}>
      <Particles
        id={id}
        className={cn("absolute inset-0 pointer-events-none", className)}
        options={options}
      />
    </ParticlesProvider>
  );
}

import type { Engine } from "@tsparticles/engine";
import { loadSlim } from "@tsparticles/slim";

/**
 * Registrar passed to <ParticlesProvider init={...}>. Must be a single
 * stable function reference across the app's lifetime — ParticlesProvider
 * throws if it ever receives a different function on a later mount, so this
 * lives at module scope (not inline in a component) and every ParticleField
 * instance imports the same one. tsParticles itself is a singleton engine,
 * so loading the slim preset once here is enough for every field on the page.
 */
export async function initSlimEngine(engine: Engine): Promise<void> {
  await loadSlim(engine);
}

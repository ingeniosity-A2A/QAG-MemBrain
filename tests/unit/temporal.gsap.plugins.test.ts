import { describe, expect, it } from "vitest";

const GSAP_MODULE_SPECIFIERS = [
  "gsap",
  "gsap/CSSPlugin",
  "gsap/CSSRulePlugin",
  "gsap/CustomBounce",
  "gsap/CustomEase",
  "gsap/CustomWiggle",
  "gsap/Draggable",
  "gsap/DrawSVGPlugin",
  "gsap/EaselPlugin",
  "gsap/Flip",
  "gsap/GSDevTools",
  "gsap/InertiaPlugin",
  "gsap/MorphSVGPlugin",
  "gsap/MotionPathHelper",
  "gsap/MotionPathPlugin",
  "gsap/Observer",
  "gsap/Physics2DPlugin",
  "gsap/PhysicsPropsPlugin",
  "gsap/PixiPlugin",
  "gsap/ScrambleTextPlugin",
  "gsap/ScrollSmoother",
  "gsap/ScrollToPlugin",
  "gsap/ScrollTrigger",
  "gsap/SplitText",
  "gsap/TextPlugin",
] as const;

describe("GSAP module resolution", () => {
  it("resolves GSAP core and all plugin modules used by temporal loader", async () => {
    for (const specifier of GSAP_MODULE_SPECIFIERS) {
      const mod = await import(specifier);
      expect(typeof mod).toBe("object");
    }
  });
});
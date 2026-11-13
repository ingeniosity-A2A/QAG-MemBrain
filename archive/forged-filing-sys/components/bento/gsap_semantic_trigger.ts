// components/bento/gsap_semantic_trigger.ts
// GSAP timeline trigger that calls SemanticExplorer search on expand
// BENTO-007-UI compatible
// Palette lock (docs/FORGED_FILE_STANDARD.md §9): three colors only — neutral / orange / yellow.
// Color mapping for F1 chunk kinds: heading→orange · code→yellow · everything else→neutral.
export const F1_KIND_COLORS: Record<string, string> = {
  heading: "orange",
  code: "yellow",
  paragraph: "neutral",
  table: "neutral",
  list: "neutral",
};

// ---------------------------------------------------------------------------
// Binding animation semantics (docs/FORGED_FILE_STANDARD.md §9) — never decoration.
// UPLOAD → ASCII GLITCH RIPPLE · F1 → GSAP SPLIT TEXT · NUMERIC → ODOMETER ·
// STAGE → SLIDE (never generic fade) · DEV-LOCKED → visible + inert + lock glyph.
// ---------------------------------------------------------------------------

export const ANIMATION_TOKENS = {
  upload: "ascii_glitch_ripple",
  f1_chunk: "gsap_split_text",
  numeric: "odometer",
  stage_transition: "slide",
  dev_locked: "visible_inert_reduced_opacity_lock_glyph",
} as const;

export type AnimationToken = (typeof ANIMATION_TOKENS)[keyof typeof ANIMATION_TOKENS];

/** UPLOAD → ASCII GLITCH RIPPLE: brief scramble then settle — a ripple, not a fade. */
export function createUploadRippleTimeline(target: gsap.DOMTarget): gsap.core.Timeline {
  const glyphs = "!<>-_\\/[]{}—=+*^?#________";
  const tl = gsap.timeline();
  const el = (Array.isArray(target) ? target[0] : target) as HTMLElement | undefined;
  if (!el || !(el instanceof HTMLElement)) return tl;
  const original = el.textContent ?? "";
  let frame = 0;
  const totalFrames = 12;
  const timer = setInterval(() => {
    frame += 1;
    const reveal = Math.floor((frame / totalFrames) * original.length);
    el.textContent =
      original
        .split("")
        .map((ch, i) =>
          i < reveal ? ch : glyphs[Math.floor(Math.random() * glyphs.length)],
        )
        .join("")
      || original;
    if (frame >= totalFrames) {
      clearInterval(timer);
      el.textContent = original;
    }
  }, 40);
  return tl;
}

/** F1 CHUNK → GSAP SPLIT TEXT: characters/words physically separate. */
export function createSplitTextTimeline(
  target: gsap.DOMTarget,
  options?: { mode?: "chars" | "words"; duration?: number; stagger?: number }
): gsap.core.Timeline {
  const { mode = "chars", duration = 0.5, stagger = 0.02 } = options ?? {};
  const nodes = gsap.utils.toArray<HTMLElement>(target);
  const tl = gsap.timeline({ paused: true });
  for (const node of nodes) {
    const text = node.textContent ?? "";
    const units = mode === "chars" ? Array.from(text) : text.split(/(\s+)/);
    node.textContent = "";
    const spans = units.map((u) => {
      const span = document.createElement("span");
      span.style.display = "inline-block";
      span.style.whiteSpace = "pre";
      span.textContent = u;
      node.appendChild(span);
      return span;
    });
    tl.fromTo(
      spans,
      { x: 0, y: 0, opacity: 1 },
      { x: "+=14", y: "-=6", opacity: 0.85, duration, stagger, ease: "power2.out" },
    );
  }
  return tl;
}

/** NUMERIC DATA → ODOMETER: digits roll, never a static number. */
export function createOdometerTween(
  target: gsap.DOMTarget,
  toValue: number,
  options?: { duration?: number; format?: (n: number) => string }
): gsap.core.Tween {
  const { duration = 0.9, format } = options ?? {};
  const el = (Array.isArray(target) ? target[0] : target) as HTMLElement | undefined;
  const state = { v: 0 };
  const fmt =
    format ??
    ((n: number) =>
      String(Math.round(n)).padStart(3, "0")); // 018 chunks · 042 skills · 94% style
  return gsap.to(state, {
    v: toValue,
    duration,
    ease: "power1.out",
    onUpdate: () => {
      if (el instanceof HTMLElement) el.textContent = fmt(state.v);
    },
  });
}

/** F0→F1→F2→F3 → SLIDE — never a generic fade transition. */
export function createStageSlideTimeline(
  incoming: gsap.DOMTarget,
  outgoing?: gsap.DOMTarget,
  options?: { duration?: number; distance?: number }
): gsap.core.Timeline {
  const { duration = 0.4, distance = 32 } = options ?? {};
  const tl = gsap.timeline();
  if (outgoing) {
    tl.to(outgoing, { x: -distance, opacity: 0, duration, ease: "power2.in" });
  }
  tl.fromTo(
    incoming,
    { x: distance, opacity: 0 },
    { x: 0, opacity: 1, duration, ease: "power2.out" },
  );
  return tl;
}

/** DEV-LOCKED → visible · inert · reduced opacity + lock glyph (binding §9). */
export function applyDevLockedSurface(el: HTMLElement, locked: boolean): void {
  if (locked) {
    el.style.opacity = "0.4";
    el.style.pointerEvents = "none";
    el.style.userSelect = "none";
    if (!el.querySelector("[data-dev-lock-glyph]")) {
      const glyph = document.createElement("span");
      glyph.setAttribute("data-dev-lock-glyph", "");
      glyph.textContent = " 🔒";
      el.appendChild(glyph);
      glyph.setAttribute("aria-label", "DEV-locked: specified but not yet operational");
    }
  } else {
    el.style.opacity = "";
    el.style.pointerEvents = "";
    el.style.userSelect = "";
    el.querySelector("[data-dev-lock-glyph]")?.remove();
  }
}

import gsap from "gsap";

export interface SemanticTriggerOptions {
  explorerRef: React.RefObject<{ search: (q: string) => Promise<void> } | null>;
  query?: string;                       // static query or function
  queryFromNode?: (node: HTMLElement) => string;
  duration?: number;
  stagger?: number;
  ease?: string;
}

/**
 * Attach a GSAP timeline that, when a folder / package node expands,
 * triggers a live turbovec search via the SemanticExplorer component
 * and animates the returned results into the view.
 */
export function createSemanticExpandTimeline(
  targets: gsap.DOMTarget,
  options: SemanticTriggerOptions
) {
  const {
    explorerRef,
    query,
    queryFromNode,
    duration = 0.45,
    stagger = 0.06,
    ease = "power2.out",
  } = options;

  const tl = gsap.timeline({ paused: true });

  // 1. Expand animation (height / opacity / scale)
  tl.fromTo(
    targets,
    { height: 0, opacity: 0, scaleY: 0.96 },
    { height: "auto", opacity: 1, scaleY: 1, duration, ease, stagger }
  );

  // 2. On start of expand → fire semantic search
  tl.call(
    () => {
      const explorer = explorerRef?.current;
      if (!explorer?.search) return;

      let q = query ?? "";
      if (!q && queryFromNode) {
        const el = Array.isArray(targets) ? targets[0] : targets;
        if (el instanceof HTMLElement) {
          q = queryFromNode(el);
        }
      }
      if (q.trim()) {
        explorer.search(q).catch(console.error);
      }
    },
    null,
    0 // at the beginning of the timeline
  );

  return tl;
}

/**
 * Convenience helper for a typical file-explorer node.
 * Reads data-domain or data-theme attribute as the search query.
 */
export function attachSemanticExpand(
  nodeSelector: string,
  explorerRef: SemanticTriggerOptions["explorerRef"]
) {
  const nodes = gsap.utils.toArray<HTMLElement>(nodeSelector);

  nodes.forEach((node) => {
    const tl = createSemanticExpandTimeline(node.querySelectorAll(".children"), {
      explorerRef,
      queryFromNode: (el) =>
        el.closest("[data-domain]")?.getAttribute("data-domain") ||
        el.closest("[data-theme]")?.getAttribute("data-theme") ||
        el.textContent?.trim() ||
        "",
    });

    // Toggle on click (example wiring)
    node.addEventListener("click", (e) => {
      e.stopPropagation();
      if (tl.reversed() || tl.paused()) {
        tl.play();
      } else {
        tl.reverse();
      }
    });
  });
}

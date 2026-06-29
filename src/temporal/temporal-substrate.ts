import gsap from "gsap";

export type SurfaceType = "a2ui" | "three" | "spatial" | "holographic";

export type Ava007State = {
  telecom: {
    status: string;
    callerId: string;
  };
  spatial: {
    objectDetected: string;
    confidence: number;
    cubeRotY: number;
    cubeRotX: number;
    activeFace?: string;
  };
  quote: {
    status: string;
    price: number;
  };
  surfaceType: SurfaceType;
  cognitiveLoad: number;
  activeSurface?: "docking" | "spatial" | "debug";
  debug?: {
    active?: boolean;
  };
};

// 1) The master memory graph timeline.
export const masterTimeline = gsap.timeline({
  paused: false,
  autoRemoveChildren: false,
  smoothChildTiming: true,
  defaults: {
    duration: 0.5,
    ease: "power3.out",
  },
});

// Global runtime state model.
export const ava007State: Ava007State = {
  telecom: { status: "idle", callerId: "" },
  spatial: {
    objectDetected: "",
    confidence: 0,
    cubeRotY: 0,
    cubeRotX: 0,
    activeFace: "front",
  },
  quote: { status: "idle", price: 0 },
  surfaceType: "a2ui",
  cognitiveLoad: 0,
  activeSurface: "docking",
  debug: { active: false },
};

// 2) Insert atomic intelligence (single mutation).
export function insertIntelligence(
  target: object,
  vars: gsap.TweenVars,
  semanticLabel?: string,
): gsap.core.Tween {
  const insertAt = masterTimeline.time();
  const tween = gsap.to(target, {
    ...vars,
    parent: masterTimeline,
  } as gsap.TweenVars & { parent: gsap.core.Timeline });

  if (semanticLabel) {
    masterTimeline.addLabel(semanticLabel, insertAt);
  }

  return tween;
}

// 3) Insert hierarchical intelligence (nested episodic memory).
export function insertEpisodicMemory(
  buildFunction: (tl: gsap.core.Timeline) => void,
  semanticLabel: string,
  position?: gsap.Position,
): gsap.core.Timeline {
  const insertAt = position ?? masterTimeline.time();
  const episodicTimeline = gsap.timeline({
    parent: masterTimeline,
    position: insertAt,
  } as gsap.TimelineVars & {
    parent: gsap.core.Timeline;
    position: gsap.Position;
  });

  buildFunction(episodicTimeline);
  masterTimeline.addLabel(semanticLabel, insertAt);

  return episodicTimeline;
}

// 4) O(1) temporal recall by coordinate or semantic label.
export function recallState(coordinate: number | string): Record<string, unknown> {
  masterTimeline.seek(coordinate);
  const snapshot: Record<string, unknown> = {};

  const flattenAnimations = (animation: gsap.core.Animation): gsap.core.Animation[] => {
    const tl = animation as gsap.core.Timeline;
    if (typeof tl.getChildren === "function") {
      return tl
        .getChildren(false, true, true)
        .flatMap((child) => flattenAnimations(child));
    }
    return [animation];
  };

  const animations = masterTimeline
    .getChildren(false, true, true)
    .flatMap((child) => flattenAnimations(child));

  animations.forEach((animation) => {
    const tween = animation as gsap.core.Tween;
    const target = tween.targets?.()[0] as Record<string, unknown> | undefined;

    if (target && typeof target === "object") {
      Object.assign(snapshot, target);
    }
  });

  return snapshot;
}

// 5) Attention modulation (global cognitive speed).
export function modulateAttention(timeScale: number) {
  masterTimeline.timeScale(timeScale);
}

// Collapse parallel branches in superposition by group metadata.
export function collapseSuperposition(groupId: string, winningTimelineId: string): void {
  masterTimeline.getChildren(false, true, false).forEach((animation) => {
    const tween = animation as gsap.core.Tween;
    const data = tween.data as { groupId?: string; id?: string } | undefined;

    if (data?.groupId === groupId && data.id !== winningTimelineId) {
      tween.kill();
    }
  });
}

export const TELNYX_RING_DEFAULT_LABEL = "telnyx-ring-001";
export const QUOTE_EPISODE_DEFAULT_LABEL = "quote-gen-weber-882";
export const QUOTE_CUBE_ROTATE_DEFAULT_LABEL = "cube-rotate-quote";

// Example A: insert semantic telecom memory when a Telnyx ring event arrives.
export function insertTelecomRingMemory(
  callerId: string,
  semanticLabel: string = TELNYX_RING_DEFAULT_LABEL,
): gsap.core.Tween {
  return insertIntelligence(
    ava007State.telecom,
    {
      status: "ringing",
      callerId,
      ease: "elastic.out(1, 0.5)",
      duration: 0.2,
    },
    semanticLabel,
  );
}

export function recallTelecomMemory(
  coordinate: number | string = TELNYX_RING_DEFAULT_LABEL,
): Ava007State["telecom"] {
  const snapshot = recallState(coordinate) as {
    status?: unknown;
    callerId?: unknown;
  };

  if (typeof snapshot.status === "string") {
    ava007State.telecom.status = snapshot.status;
  }

  if (typeof snapshot.callerId === "string") {
    ava007State.telecom.callerId = snapshot.callerId;
  }

  return { ...ava007State.telecom };
}

// Example B: quote generation as a nested episodic memory.
export function insertQuoteGenerationEpisode(
  semanticLabel: string = QUOTE_EPISODE_DEFAULT_LABEL,
): gsap.core.Timeline {
  return insertEpisodicMemory((episodicTl) => {
    episodicTl.to(ava007State.quote, {
      status: "analyzing",
      duration: 0.5,
      ease: "power1.in",
    });

    episodicTl.to(
      ava007State.spatial,
      {
        confidence: 0.94,
        duration: 0.3,
        ease: "power4.out",
      },
      "-=0.2",
    );

    episodicTl.to(ava007State.quote, {
      status: "ready",
      price: 149.0,
      duration: 0.4,
      ease: "power3.out",
    });
  }, semanticLabel);
}

export function insertQuoteCubeRotation(
  semanticLabel: string = QUOTE_CUBE_ROTATE_DEFAULT_LABEL,
): gsap.core.Tween {
  return insertIntelligence(
    ava007State.spatial,
    {
      cubeRotY: "+=90",
      duration: 1.2,
    },
    semanticLabel,
  );
}

// Example C: emergency attention modulation.
export function enterEmergencyAttentionMode(): void {
  modulateAttention(2.0);
}

// Console helper: runs telecom + quote + cube + attention in one call.
export function runQgaConsoleDemo(callerId: string = "+15551234567") {
  insertTelecomRingMemory(callerId, TELNYX_RING_DEFAULT_LABEL);
  insertQuoteGenerationEpisode(QUOTE_EPISODE_DEFAULT_LABEL);
  insertQuoteCubeRotation(QUOTE_CUBE_ROTATE_DEFAULT_LABEL);
  enterEmergencyAttentionMode();

  return {
    ringLabel: TELNYX_RING_DEFAULT_LABEL,
    quoteLabel: QUOTE_EPISODE_DEFAULT_LABEL,
    cubeLabel: QUOTE_CUBE_ROTATE_DEFAULT_LABEL,
  };
}
import { useEffect, useRef, useState } from "react";
import "./styles.css";

type Phase = "title" | "playing" | "summit" | "celebrate" | "win";

type Confetto = { x: number; y: number; vx: number; vy: number; color: string };

const CELEBRATE_SECONDS = 7;
// On reaching the top, the hiker arrives on a rocky peak above the clouds and
// jumps with a fist in the air before the "Whoo!" screen takes over.
const ARRIVAL_WALK = 1.0;
const ARRIVAL_SECONDS = 3.4;
const SUMMIT_APEX_Y = 112; // rocky peak top the hiker stands on
const SUMMIT_HERO_X = 156; // where the hiker stands and jumps on top

// Rotating Marcus Aurelius quotes shown at the summit.
const MARCUS_QUOTES = [
  "You have power over your mind, not outside events. Realize this, and you will find strength.",
  "The impediment to action advances action. What stands in the way becomes the way.",
  "Waste no more time arguing about what a good person should be. Be one.",
  "The happiness of your life depends upon the quality of your thoughts.",
];

type Critter = {
  kind: "bear" | "lion" | "deer";
  x: number;
  passed: boolean;
};

// World units (logical pixels). We render at this resolution and scale up
// with imageSmoothingEnabled=false to keep the chunky 90s look.
const W = 320;
const H = 160;
// Hillside: the ground line slopes upward to the right so the player visibly
// climbs. Left edge is low, right edge is high.
const GROUND_LEFT_Y = 148;
const GROUND_RIGHT_Y = 70;
const slopeAt = (x: number) =>
  GROUND_LEFT_Y - (x / W) * (GROUND_LEFT_Y - GROUND_RIGHT_Y);
const PLAYER_X = 56;
const PLAYER_GROUND_Y = slopeAt(PLAYER_X);
const SUMMIT_SECONDS = 15;
const SCROLL_SPEED = 70; // logical px / s

export const HikeGame = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Lets the canvas input handler (inside the effect) start a run.
  const beginRunRef = useRef<() => void>(() => {});
  const [phase, setPhase] = useState<Phase>("title");
  const [winTime, setWinTime] = useState<number | null>(null);
  const [winHits, setWinHits] = useState(0);
  // Lets the player minimize or close the "You made it!" overlay.
  const [winMinimized, setWinMinimized] = useState(false);
  const [winDismissed, setWinDismissed] = useState(false);
  const [bestTime, setBestTime] = useState<number | null>(() => {
    const raw = localStorage.getItem("hike-best");
    return raw ? Number(raw) : null;
  });

  // Refs hold mutable game state so the loop doesn't trigger React re-renders.
  const stateRef = useRef({
    phase: "title" as Phase,
    elapsed: 0,
    progress: 0,
    player: { y: PLAYER_GROUND_Y, vy: 0, onGround: true, hitFlash: 0 },
    hits: 0,
    critters: [] as Critter[],
    spawnTimer: 0.8,
    bgScroll: 0,
    rngSeed: 1,
    summitElapsed: 0,
    celebrateTimer: 0,
    celebrateElapsed: 0,
    finalTime: 0,
    confetti: [] as Confetto[],
    // Rotates so each summit shows a different quote; random start for variety.
    quoteIdx: Math.floor(Math.random() * MARCUS_QUOTES.length),
    quote: MARCUS_QUOTES[0],
    bestShown: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Sharp pixels.
    ctx.imageSmoothingEnabled = false;

    const scale = canvas.width / W;

    const input = () => {
      const s = stateRef.current;
      // From the title screen or a finished win, any tap/space/click starts a
      // fresh climb. During the celebration the input is ignored.
      if (s.phase === "title" || s.phase === "win") {
        beginRunRef.current();
        return;
      }
      if (s.phase !== "playing") return;
      if (s.player.onGround) {
        s.player.vy = -190;
        s.player.onGround = false;
      }
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        // When embedded on the homepage, don't hijack the spacebar unless the
        // game is actually on screen.
        const rect = canvas.getBoundingClientRect();
        const visible = rect.bottom > 0 && rect.top < window.innerHeight;
        if (!visible) return;
        e.preventDefault();
        input();
      }
    };
    const handleClick = () => input();
    const handleTouch = (e: TouchEvent) => {
      e.preventDefault();
      input();
    };

    window.addEventListener("keydown", handleKey);
    canvas.addEventListener("mousedown", handleClick);
    canvas.addEventListener("touchstart", handleTouch, { passive: false });

    // -------- Render helpers --------

    // Lightweight LCG so spawns are varied but deterministic enough to feel
    // consistent across runs.
    const rand = () => {
      const s = stateRef.current;
      s.rngSeed = (s.rngSeed * 1664525 + 1013904223) >>> 0;
      return s.rngSeed / 0xffffffff;
    };

    const drawBackground = (bgScroll: number, progress: number) => {
      // Sky gradient: deep space at top to lighter navy near the ridge.
      const sky = ctx.createLinearGradient(0, 0, 0, GROUND_LEFT_Y);
      sky.addColorStop(0, "#0b0b22");
      sky.addColorStop(1, "#241a3e");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // A few stars.
      ctx.fillStyle = "#ffffff";
      const stars: Array<[number, number]> = [
        [20, 18], [60, 32], [110, 12], [165, 26], [210, 38],
        [255, 14], [288, 30], [40, 50], [140, 56], [230, 60],
      ];
      stars.forEach(([sx, sy], i) => {
        const blink = (Math.floor((stateRef.current.elapsed * 4) + i) % 3) === 0;
        ctx.globalAlpha = blink ? 0.45 : 1;
        ctx.fillRect(sx, sy, 1, 1);
      });
      ctx.globalAlpha = 1;

      // Distant mountain silhouettes (parallax slow).
      ctx.fillStyle = "#1f1840";
      const farOffset = (bgScroll * 0.25) % 80;
      for (let i = -1; i < 5; i += 1) {
        const baseX = i * 80 - farOffset;
        ctx.beginPath();
        ctx.moveTo(baseX, 96);
        ctx.lineTo(baseX + 24, 64);
        ctx.lineTo(baseX + 40, 80);
        ctx.lineTo(baseX + 60, 56);
        ctx.lineTo(baseX + 80, 96);
        ctx.closePath();
        ctx.fill();
      }

      // Nearer mountain row.
      ctx.fillStyle = "#2e2255";
      const nearOffset = (bgScroll * 0.5) % 60;
      for (let i = -1; i < 7; i += 1) {
        const baseX = i * 60 - nearOffset;
        ctx.beginPath();
        ctx.moveTo(baseX, 112);
        ctx.lineTo(baseX + 18, 84);
        ctx.lineTo(baseX + 30, 96);
        ctx.lineTo(baseX + 44, 76);
        ctx.lineTo(baseX + 60, 112);
        ctx.closePath();
        ctx.fill();
      }

      // The summit peak: a snowy mountain top at the right edge that grows
      // larger as the player climbs, giving a sense of arriving somewhere.
      const peakBaseX = W - 4;
      const peakBaseY = GROUND_RIGHT_Y + 2;
      const peakSize = 20 + progress * 60; // grows from far away to looming
      ctx.fillStyle = "#3a2e60";
      ctx.beginPath();
      ctx.moveTo(peakBaseX - peakSize, peakBaseY);
      ctx.lineTo(peakBaseX - peakSize * 0.55, peakBaseY - peakSize * 1.05);
      ctx.lineTo(peakBaseX, peakBaseY);
      ctx.closePath();
      ctx.fill();
      // Snow cap
      ctx.fillStyle = "#f5f3ff";
      ctx.beginPath();
      ctx.moveTo(peakBaseX - peakSize * 0.78, peakBaseY - peakSize * 0.55);
      ctx.lineTo(peakBaseX - peakSize * 0.55, peakBaseY - peakSize * 1.05);
      ctx.lineTo(peakBaseX - peakSize * 0.3, peakBaseY - peakSize * 0.5);
      ctx.lineTo(peakBaseX - peakSize * 0.45, peakBaseY - peakSize * 0.6);
      ctx.lineTo(peakBaseX - peakSize * 0.55, peakBaseY - peakSize * 0.5);
      ctx.lineTo(peakBaseX - peakSize * 0.65, peakBaseY - peakSize * 0.62);
      ctx.closePath();
      ctx.fill();
      // Summit flag at the very top once you're close.
      if (progress > 0.4) {
        const flagX = peakBaseX - peakSize * 0.55;
        const flagY = peakBaseY - peakSize * 1.05;
        ctx.fillStyle = "#000000";
        ctx.fillRect(flagX, flagY - 6, 1, 6);
        ctx.fillStyle = "#facc15";
        ctx.fillRect(flagX + 1, flagY - 6, 4, 3);
      }

      // The hillside: a steady uphill slope from lower-left to upper-right.
      // Draw the entire ground polygon to fill everything below the slope.
      ctx.fillStyle = "#1a3a2a";
      ctx.beginPath();
      ctx.moveTo(0, GROUND_LEFT_Y);
      ctx.lineTo(W, GROUND_RIGHT_Y);
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.closePath();
      ctx.fill();

      // Grass edge along the slope (a 2px brighter strip).
      ctx.fillStyle = "#27583e";
      ctx.beginPath();
      ctx.moveTo(0, GROUND_LEFT_Y);
      ctx.lineTo(W, GROUND_RIGHT_Y);
      ctx.lineTo(W, GROUND_RIGHT_Y + 2);
      ctx.lineTo(0, GROUND_LEFT_Y + 2);
      ctx.closePath();
      ctx.fill();

      // Tiny shrubs scrolling at full speed, tucked just under the slope edge.
      ctx.fillStyle = "#0f2a1f";
      const shrubOffset = bgScroll % 32;
      for (let i = -1; i < 12; i += 1) {
        const sx = i * 32 - shrubOffset;
        const sy = slopeAt(sx);
        ctx.fillRect(sx, sy + 4, 3, 2);
        ctx.fillRect(sx + 1, sy + 3, 2, 1);
      }
    };

    const drawPlayer = (y: number, hitFlash: number, elapsed: number, atX = PLAYER_X) => {
      const x = atX;
      const frame = Math.floor(elapsed * 8) % 2; // two-frame run cycle
      const yi = Math.round(y);
      const flashing = hitFlash > 0 && Math.floor(hitFlash * 20) % 2 === 0;

      // Body
      ctx.fillStyle = flashing ? "#ff5e7a" : "#7c3aed";
      ctx.fillRect(x, yi - 18, 8, 10); // torso
      // Head
      ctx.fillStyle = flashing ? "#ffd0d8" : "#f5d0c5";
      ctx.fillRect(x + 1, yi - 24, 6, 6);
      // Hair
      ctx.fillStyle = "#3a2a1a";
      ctx.fillRect(x + 1, yi - 25, 6, 2);
      // Backpack
      ctx.fillStyle = "#22c55e";
      ctx.fillRect(x - 2, yi - 17, 3, 8);
      // Legs (alternate)
      ctx.fillStyle = "#241a3e";
      if (frame === 0) {
        ctx.fillRect(x + 1, yi - 8, 2, 8);
        ctx.fillRect(x + 5, yi - 8, 2, 6);
      } else {
        ctx.fillRect(x + 1, yi - 8, 2, 6);
        ctx.fillRect(x + 5, yi - 8, 2, 8);
      }
      // Arm
      ctx.fillStyle = flashing ? "#ff5e7a" : "#7c3aed";
      ctx.fillRect(x + 7, yi - 16, 2, 5);
    };

    const drawCritter = (c: Critter) => {
      const xi = Math.round(c.x);
      const y = Math.round(slopeAt(c.x + 8));
      if (c.kind === "bear") {
        // Round dark-brown bear
        ctx.fillStyle = "#3a2418";
        ctx.fillRect(xi, y - 10, 14, 10); // body
        ctx.fillRect(xi + 11, y - 13, 5, 5); // head
        ctx.fillStyle = "#1c0f08";
        ctx.fillRect(xi + 14, y - 14, 1, 1); // ear
        ctx.fillRect(xi + 11, y - 14, 1, 1);
        ctx.fillStyle = "#ff2222";
        ctx.fillRect(xi + 14, y - 12, 1, 1); // eye glint
        ctx.fillStyle = "#3a2418";
        ctx.fillRect(xi, y - 2, 3, 2); // legs
        ctx.fillRect(xi + 11, y - 2, 3, 2);
      } else if (c.kind === "lion") {
        // Tan mountain lion (lower, longer)
        ctx.fillStyle = "#b07a3a";
        ctx.fillRect(xi, y - 7, 16, 7);
        ctx.fillRect(xi + 13, y - 11, 6, 6);
        ctx.fillStyle = "#7a4d1f";
        ctx.fillRect(xi + 18, y - 8, 1, 4); // tail
        ctx.fillRect(xi + 17, y - 11, 1, 1); // ear
        ctx.fillStyle = "#ffd966";
        ctx.fillRect(xi + 17, y - 9, 1, 1); // eye
        ctx.fillStyle = "#b07a3a";
        ctx.fillRect(xi, y - 2, 3, 2);
        ctx.fillRect(xi + 12, y - 2, 3, 2);
      } else {
        // Deer (taller, with antlers)
        ctx.fillStyle = "#7a4a26";
        ctx.fillRect(xi + 2, y - 12, 10, 8); // body
        ctx.fillRect(xi + 10, y - 18, 4, 6); // neck/head
        ctx.fillStyle = "#5a3416";
        ctx.fillRect(xi + 11, y - 20, 1, 2); // antler
        ctx.fillRect(xi + 13, y - 20, 1, 2);
        ctx.fillRect(xi + 10, y - 21, 1, 1);
        ctx.fillRect(xi + 14, y - 21, 1, 1);
        ctx.fillStyle = "#000000";
        ctx.fillRect(xi + 12, y - 16, 1, 1); // eye
        ctx.fillStyle = "#7a4a26";
        ctx.fillRect(xi + 3, y - 4, 2, 4); // legs
        ctx.fillRect(xi + 9, y - 4, 2, 4);
      }
    };

    const drawProgressBar = (progress: number, elapsed: number) => {
      const barX = 24;
      const barY = 8;
      const barW = W - 48;
      const barH = 6;
      // Frame
      ctx.fillStyle = "#000000";
      ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
      ctx.fillStyle = "#1f1830";
      ctx.fillRect(barX, barY, barW, barH);
      // Fill
      ctx.fillStyle = "#22c55e";
      ctx.fillRect(barX, barY, Math.max(0, Math.round(barW * progress)), barH);
      // Summit flag at the right end
      ctx.fillStyle = "#facc15";
      ctx.fillRect(barX + barW + 2, barY - 4, 1, 10);
      ctx.fillRect(barX + barW + 3, barY - 4, 3, 3);

      // Time text
      ctx.fillStyle = "#e8e8ff";
      ctx.font = "8px monospace";
      ctx.textAlign = "left";
      ctx.fillText(elapsed.toFixed(1) + "s", barX, barY + barH + 10);
    };

    // Damage score, top-right under the progress bar. You never lose; hits
    // just raise this and slow the climb.
    const drawDamage = (hits: number) => {
      ctx.textAlign = "right";
      ctx.font = "8px monospace";
      ctx.fillStyle = hits > 0 ? "#ff8da3" : "#9aa0c0";
      ctx.fillText("DMG " + hits, W - 6, 22);
      ctx.textAlign = "left";
    };

    // The hiker standing at the summit, both fists raised, bouncing.
    const drawSummitHero = (cx: number, cy: number, bounce: number) => {
      const x = Math.round(cx);
      const yi = Math.round(cy - bounce);
      // Backpack
      ctx.fillStyle = "#22c55e";
      ctx.fillRect(x - 3, yi - 17, 3, 8);
      // Torso
      ctx.fillStyle = "#7c3aed";
      ctx.fillRect(x, yi - 18, 8, 10);
      // Head
      ctx.fillStyle = "#f5d0c5";
      ctx.fillRect(x + 1, yi - 24, 6, 6);
      // Hair
      ctx.fillStyle = "#3a2a1a";
      ctx.fillRect(x + 1, yi - 25, 6, 2);
      // Legs (planted, feet apart in a victory stance)
      ctx.fillStyle = "#241a3e";
      ctx.fillRect(x, yi - 8, 2, 8);
      ctx.fillRect(x + 6, yi - 8, 2, 8);
      // Both arms raised with fists
      ctx.fillStyle = "#7c3aed";
      ctx.fillRect(x - 2, yi - 26, 2, 9); // left arm up
      ctx.fillRect(x + 8, yi - 26, 2, 9); // right arm up
      ctx.fillStyle = "#f5d0c5";
      ctx.fillRect(x - 2, yi - 28, 3, 3); // left fist
      ctx.fillRect(x + 8, yi - 28, 3, 3); // right fist
    };

    // The shape of the rocky peak top near the hiker (rounded, not flat, not
    // sloped). Returns the rock-surface y for a given x around the apex.
    const rockTopY = (x: number) =>
      SUMMIT_APEX_Y + Math.pow((x - SUMMIT_HERO_X) / 44, 2) * 12;

    // The arrival scene: the hiker is on a rocky peak top, above a sea of
    // clouds. Walks onto the rock, then jumps with a fist in the air.
    const drawSummitScene = (t: number) => {
      // Sky: dark up high, brightening to a high-altitude blue at the horizon.
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#0b0b22");
      sky.addColorStop(0.55, "#274073");
      sky.addColorStop(1, "#4f78b4");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // Stars, only up in the darker sky.
      ctx.fillStyle = "#ffffff";
      const stars: Array<[number, number]> = [
        [22, 16], [64, 26], [112, 12], [168, 22], [214, 30],
        [258, 14], [292, 24], [42, 40], [150, 44], [236, 38],
      ];
      stars.forEach(([sx, sy], i) => {
        ctx.globalAlpha = Math.floor(t * 5 + i) % 3 === 0 ? 0.35 : 0.9;
        ctx.fillRect(sx, sy, 1, 1);
      });
      ctx.globalAlpha = 1;

      // Sea of clouds below: a filled band with a soft, puffy top edge.
      const cloudY = 104;
      ctx.fillStyle = "#9aa6cf";
      ctx.fillRect(0, cloudY, W, H - cloudY);
      const cloudEdge = (yy: number, r: number, color: string, step: number, off: number) => {
        ctx.fillStyle = color;
        for (let x = off; x < W + r; x += step) {
          ctx.beginPath();
          ctx.arc(x, yy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      };
      cloudEdge(cloudY, 9, "#cdd5ee", 15, 2);
      cloudEdge(cloudY + 4, 8, "#b3bce0", 13, 8);
      cloudEdge(cloudY + 2, 6, "#dfe5f6", 19, 12);

      // The rocky peak (foreground), rising above the clouds. Rounded top.
      ctx.fillStyle = "#473b36";
      ctx.beginPath();
      ctx.moveTo(0, H);
      ctx.lineTo(0, 150);
      ctx.quadraticCurveTo(54, 140, 104, 128);
      ctx.quadraticCurveTo(SUMMIT_HERO_X, 110, 208, 128);
      ctx.quadraticCurveTo(258, 140, W, 150);
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
      // Sunlit highlight along the rounded top.
      ctx.strokeStyle = "#6b5a4e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(104, 127);
      ctx.quadraticCurveTo(SUMMIT_HERO_X, 109, 208, 127);
      ctx.stroke();
      // Rock detail and a few snow patches.
      ctx.fillStyle = "#332a26";
      ctx.fillRect(96, 140, 6, 3);
      ctx.fillRect(150, 150, 8, 3);
      ctx.fillRect(214, 138, 5, 3);
      ctx.fillStyle = "#eef0ff";
      ctx.fillRect(132, 124, 5, 2);
      ctx.fillRect(176, 126, 6, 2);

      // The hiker: walk onto the rock, then jump in place with a fist up.
      if (t < ARRIVAL_WALK) {
        const p = t / ARRIVAL_WALK;
        const ease = 1 - (1 - p) * (1 - p);
        const x = SUMMIT_HERO_X - 40 + 40 * ease;
        drawPlayer(rockTopY(x + 4), 0, t, x);
      } else {
        const jt = t - ARRIVAL_WALK;
        const jump = Math.abs(Math.sin(jt * 5.5)) * 12; // happy hops
        drawSummitHero(SUMMIT_HERO_X, SUMMIT_APEX_Y, jump);
      }
    };

    const wrapText = (text: string, maxWidth: number): string[] => {
      const words = text.split(" ");
      const lines: string[] = [];
      let line = "";
      for (const word of words) {
        const test = line ? line + " " + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
      return lines;
    };

    const drawCelebration = (
      t: number,
      confetti: Confetto[],
      finalTime: number,
      quote: string,
      bestShown: number,
      hits: number,
    ) => {
      // Sky
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#0b0b22");
      sky.addColorStop(1, "#2a1f4a");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // Stars
      ctx.fillStyle = "#ffffff";
      const stars: Array<[number, number]> = [
        [24, 20], [70, 34], [120, 16], [175, 28], [220, 40],
        [262, 18], [292, 34], [44, 54], [150, 58], [240, 64],
      ];
      stars.forEach(([sx, sy], i) => {
        ctx.globalAlpha = Math.floor(t * 6 + i) % 3 === 0 ? 0.4 : 1;
        ctx.fillRect(sx, sy, 1, 1);
      });
      ctx.globalAlpha = 1;

      // Distant peaks below the horizon to imply great height.
      ctx.fillStyle = "#1f1840";
      for (let i = 0; i < 5; i += 1) {
        const bx = i * 70 - 10;
        ctx.beginPath();
        ctx.moveTo(bx, 120);
        ctx.lineTo(bx + 22, 96);
        ctx.lineTo(bx + 44, 120);
        ctx.closePath();
        ctx.fill();
      }

      // The summit: a snowy peak the hero stands on, centered, sitting in the
      // upper half so the lower half can carry the quote like a regal plaque.
      const peakCx = W / 2;
      const apexY = 50;
      const peakBaseY = 92;
      ctx.fillStyle = "#3a2e60";
      ctx.beginPath();
      ctx.moveTo(peakCx - 56, peakBaseY);
      ctx.lineTo(peakCx, apexY);
      ctx.lineTo(peakCx + 56, peakBaseY);
      ctx.closePath();
      ctx.fill();
      // Snow cap
      ctx.fillStyle = "#f5f3ff";
      ctx.beginPath();
      ctx.moveTo(peakCx - 18, apexY + 18);
      ctx.lineTo(peakCx, apexY);
      ctx.lineTo(peakCx + 18, apexY + 18);
      ctx.lineTo(peakCx + 7, apexY + 11);
      ctx.lineTo(peakCx, apexY + 18);
      ctx.lineTo(peakCx - 8, apexY + 10);
      ctx.closePath();
      ctx.fill();

      // Confetti
      for (const p of confetti) {
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
      }

      // The celebrating hero on the peak apex, bouncing.
      const bounce = Math.abs(Math.sin(t * 6)) * 4;
      drawSummitHero(peakCx - 4, apexY + 6, bounce);

      // Run stats in the upper-left, off to the side.
      ctx.save();
      ctx.fillStyle = "rgba(7, 7, 26, 0.55)";
      ctx.fillRect(6, 8, 76, 37);
      ctx.fillStyle = "#caa64a";
      ctx.fillRect(6, 8, 76, 1);
      ctx.textAlign = "left";
      ctx.font = "7px monospace";
      ctx.fillStyle = "#9aa0c0";
      ctx.fillText("TIME", 11, 19);
      ctx.fillText("BEST", 11, 30);
      ctx.fillText("DMG", 11, 41);
      ctx.font = "bold 9px monospace";
      ctx.fillStyle = "#facc15";
      ctx.fillText(finalTime.toFixed(2) + "s", 40, 20);
      ctx.fillStyle = "#e8e8ff";
      ctx.fillText(bestShown.toFixed(2) + "s", 40, 31);
      ctx.fillStyle = hits > 0 ? "#ff8da3" : "#e8e8ff";
      ctx.fillText(String(hits), 40, 42);
      ctx.restore();

      // "WHOO!" popping in above the hero.
      const pop = Math.min(1, t * 4);
      ctx.save();
      ctx.textAlign = "center";
      ctx.fillStyle = "#facc15";
      ctx.font = `bold ${Math.round(11 * pop) + 3}px monospace`;
      ctx.fillText("WHOO! 🎉", peakCx + 2, 26 - bounce);
      ctx.restore();

      // ---- Regal quote plaque in the lower half ----
      const plaqueTop = 100;
      const plaqueBot = H - 4;
      // Dark translucent banner.
      ctx.fillStyle = "rgba(7, 7, 26, 0.62)";
      ctx.fillRect(0, plaqueTop, W, plaqueBot - plaqueTop);
      // Gold rules top and bottom for a regal frame.
      ctx.fillStyle = "#caa64a";
      ctx.fillRect(20, plaqueTop, W - 40, 1);
      ctx.fillRect(20, plaqueBot - 1, W - 40, 1);
      // Small gold diamonds as end ornaments.
      ctx.fillStyle = "#facc15";
      [20, W - 21].forEach((ox) => {
        ctx.fillRect(ox, plaqueTop - 1, 2, 2);
        ctx.fillRect(ox, plaqueBot - 2, 2, 2);
      });

      // Quote text: serif italic, gold, centered, wrapped, fading in.
      ctx.save();
      ctx.textAlign = "center";
      ctx.globalAlpha = Math.min(1, Math.max(0, (t - 0.3) * 2));
      ctx.font = "italic 9px Georgia, 'Times New Roman', serif";
      const lines = wrapText('"' + quote + '"', W - 52);
      const lineH = 12;
      const blockH = lines.length * lineH;
      let ty = plaqueTop + 14 + ((plaqueBot - plaqueTop - 16 - blockH - 10) / 2);
      ctx.fillStyle = "#fde68a";
      for (const ln of lines) {
        ctx.fillText(ln, W / 2, ty);
        ty += lineH;
      }
      // Attribution in regal small caps.
      ctx.font = "bold 7px Georgia, serif";
      ctx.fillStyle = "#caa64a";
      ctx.fillText("· MARCUS AURELIUS ·", W / 2, ty + 2);
      ctx.restore();
    };

    // -------- Game loop --------

    let last = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const s = stateRef.current;

      // Clear scaled drawing back to logical units.
      ctx.setTransform(scale, 0, 0, scale, 0, 0);

      if (s.phase === "playing") {
        s.elapsed += dt;
        s.bgScroll += SCROLL_SPEED * dt;

        // Climb progress advances on its own; elapsed tracks the real time
        // the run takes. Collisions knock progress back (below), so a clean
        // run reaches the top in ~SUMMIT_SECONDS while stumbles add real time.
        s.progress = Math.min(1, s.progress + dt / SUMMIT_SECONDS);

        // Player physics
        if (!s.player.onGround) {
          s.player.vy += 520 * dt; // gravity
          s.player.y += s.player.vy * dt;
          if (s.player.y >= PLAYER_GROUND_Y) {
            s.player.y = PLAYER_GROUND_Y;
            s.player.vy = 0;
            s.player.onGround = true;
          }
        }
        if (s.player.hitFlash > 0) s.player.hitFlash = Math.max(0, s.player.hitFlash - dt);

        // Spawn critters
        s.spawnTimer -= dt;
        if (s.spawnTimer <= 0) {
          const roll = rand();
          const kind: Critter["kind"] =
            roll < 0.45 ? "bear" : roll < 0.8 ? "lion" : "deer";
          s.critters.push({ kind, x: W + 8, passed: false });
          // Variable cadence keeps it interesting; tighter as you climb.
          s.spawnTimer = 0.9 + rand() * 0.9 - s.progress * 0.25;
        }

        // Move + cull critters, check collisions
        for (const c of s.critters) {
          c.x -= SCROLL_SPEED * dt * 1.4;
          if (!c.passed && c.x + 16 < PLAYER_X) {
            c.passed = true;
          }
          // Collision box check (critter feet sit on the slope).
          const px = PLAYER_X;
          const pyTop = s.player.y - 24;
          const pyBot = s.player.y;
          const cx = c.x;
          const cFootY = slopeAt(c.x + 8);
          const cTop = c.kind === "deer" ? cFootY - 20 : cFootY - 13;
          const cBot = cFootY;
          const overlapX = cx < px + 8 && cx + 16 > px;
          const overlapY = cTop < pyBot && cBot > pyTop;
          if (overlapX && overlapY && s.player.hitFlash <= 0) {
            // Bumping a critter adds to the damage score and knocks you back
            // down the hill, so the run takes longer. You never lose.
            s.hits += 1;
            s.progress = Math.max(0, s.progress - 0.07);
            s.player.hitFlash = 0.9;
          }
        }
        s.critters = s.critters.filter((c) => c.x > -24);

        // Reached the summit: start the on-canvas celebration first, then
        // show the results overlay after CELEBRATE_SECONDS.
        if (s.progress >= 1) {
          // Reached the top: the hiker arrives on the rocky peak and jumps
          // with a fist up before the "Whoo!" screen.
          s.phase = "summit";
          s.finalTime = s.elapsed;
          s.summitElapsed = 0;
          s.critters = [];
          setPhase("summit");
        }
      } else if (s.phase === "summit") {
        s.summitElapsed += dt;
        if (s.summitElapsed >= ARRIVAL_SECONDS) {
          s.phase = "celebrate";
          s.celebrateTimer = CELEBRATE_SECONDS;
          s.celebrateElapsed = 0;
          // Pick the next quote in rotation so each summit differs.
          s.quote = MARCUS_QUOTES[s.quoteIdx % MARCUS_QUOTES.length];
          s.quoteIdx += 1;
          // Best time to display this run (the stored best is written later,
          // at the win transition, so read it now for the previous best).
          const storedBest = Number(localStorage.getItem("hike-best"));
          const prevBest =
            storedBest && !Number.isNaN(storedBest) ? storedBest : null;
          s.bestShown = prevBest == null ? s.finalTime : Math.min(prevBest, s.finalTime);
          // Burst of confetti from the top of the summit.
          const colors = ["#facc15", "#7c3aed", "#22c55e", "#38bdf8", "#fb7185", "#ffffff"];
          s.confetti = [];
          for (let i = 0; i < 60; i += 1) {
            s.confetti.push({
              x: W * 0.5 + (rand() - 0.5) * 60,
              y: 30 + rand() * 20,
              vx: (rand() - 0.5) * 70,
              vy: 20 + rand() * 60,
              color: colors[Math.floor(rand() * colors.length)],
            });
          }
          setPhase("celebrate");
        }
      } else if (s.phase === "celebrate") {
        s.celebrateElapsed += dt;
        s.celebrateTimer -= dt;
        // Animate confetti falling.
        for (const p of s.confetti) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += 40 * dt; // gentle gravity
        }
        if (s.celebrateTimer <= 0) {
          s.phase = "win";
          setWinTime(s.finalTime);
          setWinHits(s.hits);
          setPhase("win");
          setBestTime((prev) => {
            const next = prev == null ? s.finalTime : Math.min(prev, s.finalTime);
            localStorage.setItem("hike-best", String(next));
            return next;
          });
        }
      }

      // ---- Draw ----
      if (s.phase === "celebrate" || s.phase === "win") {
        drawCelebration(s.celebrateElapsed, s.confetti, s.finalTime, s.quote, s.bestShown, s.hits);
      } else if (s.phase === "summit") {
        drawSummitScene(s.summitElapsed);
        drawProgressBar(1, s.finalTime);
        drawDamage(s.hits);
      } else {
        drawBackground(s.bgScroll, s.progress);
        for (const c of s.critters) drawCritter(c);
        drawPlayer(s.player.y, s.player.hitFlash, s.elapsed);
        drawProgressBar(s.progress, s.elapsed);
        if (s.phase === "playing") drawDamage(s.hits);
      }

      if (s.phase === "title") {
        ctx.fillStyle = "rgba(7, 7, 26, 0.78)";
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#facc15";
        ctx.font = "bold 14px monospace";
        ctx.textAlign = "center";
        ctx.fillText("HIKE TO THE TOP", W / 2, H / 2 - 14);
        ctx.fillStyle = "#e8e8ff";
        ctx.font = "8px monospace";
        ctx.fillText("SPACE / CLICK to JUMP", W / 2, H / 2 + 2);
        ctx.fillText("Avoid bears, lions, deer", W / 2, H / 2 + 14);
        ctx.fillStyle = "#7c3aed";
        ctx.fillText("[ click to start ]", W / 2, H / 2 + 30);
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", handleKey);
      canvas.removeEventListener("mousedown", handleClick);
      canvas.removeEventListener("touchstart", handleTouch);
    };
  }, []);

  const startRun = () => {
    const s = stateRef.current;
    s.phase = "playing";
    s.elapsed = 0;
    s.progress = 0;
    s.player = { y: PLAYER_GROUND_Y, vy: 0, onGround: true, hitFlash: 0 };
    s.hits = 0;
    s.critters = [];
    s.spawnTimer = 1.0;
    s.bgScroll = 0;
    s.rngSeed = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
    s.summitElapsed = 0;
    s.celebrateTimer = 0;
    s.celebrateElapsed = 0;
    s.finalTime = 0;
    s.confetti = [];
    setPhase("playing");
    setWinTime(null);
    setWinHits(0);
    setWinMinimized(false);
    setWinDismissed(false);
  };
  // Allow the canvas input handler (inside the effect) to start a run.
  beginRunRef.current = startRun;

  return (
    <section className="hg-section">
      <div className="hg-inner">
        <div className="hg-header">
          <h1 className="hg-title">Hike to the Top</h1>
          <p className="hg-subtitle">
            A tiny 90s-inspired pixel game. Jump over bears, mountain lions, and
            deer, and reach the summit.
          </p>
        </div>

        <div className="hg-card">
          <canvas
            ref={canvasRef}
            width={960}
            height={480}
            className="hg-canvas"
            style={{ imageRendering: "pixelated", touchAction: "manipulation" }}
          />

          {phase === "win" && winTime != null && !winDismissed && !winMinimized && (
            <div className="hg-overlay">
              <div className="hg-controls">
                <button
                  type="button"
                  aria-label="Minimize"
                  className="hg-icon-btn"
                  onClick={() => setWinMinimized(true)}
                >
                  &#8211;
                </button>
                <button
                  type="button"
                  aria-label="Close"
                  className="hg-icon-btn"
                  onClick={() => setWinDismissed(true)}
                >
                  &#10005;
                </button>
              </div>
              <div className="hg-result">
                <div className="hg-emoji">&#9994;&#127881;&#127956;</div>
                <p className="hg-result-title">You made it!</p>
                <p className="hg-stat">
                  Summit time:{" "}
                  <span className="hg-mono hg-amber">{winTime.toFixed(2)}s</span>
                </p>
                <p className="hg-stat">
                  Damage taken:{" "}
                  <span className={winHits > 0 ? "hg-mono hg-rose" : "hg-mono hg-green"}>
                    {winHits}
                  </span>
                </p>
                {bestTime != null && (
                  <p className="hg-stat hg-best">
                    Best time:{" "}
                    <span className="hg-mono">{bestTime.toFixed(2)}s</span>
                  </p>
                )}
                <button type="button" className="hg-btn" onClick={startRun}>
                  Climb again
                </button>
              </div>
            </div>
          )}

          {phase === "win" && winTime != null && !winDismissed && winMinimized && (
            <div className="hg-pill">
              <span className="hg-pill-emoji">&#127956;</span>
              <span className="hg-pill-text">
                You made it!{" "}
                <span className="hg-mono hg-amber">{winTime.toFixed(2)}s</span>
                {" · "}
                <span className="hg-mono hg-dim">DMG {winHits}</span>
              </span>
              <button
                type="button"
                aria-label="Expand"
                className="hg-icon-btn hg-icon-btn-sm"
                onClick={() => setWinMinimized(false)}
              >
                &#9974;
              </button>
              <button
                type="button"
                aria-label="Close"
                className="hg-icon-btn hg-icon-btn-sm"
                onClick={() => setWinDismissed(true)}
              >
                &#10005;
              </button>
            </div>
          )}
        </div>

        <p className="hg-hint">
          Controls: <kbd className="hg-kbd">Space</kbd> or click / tap to jump.
          Each critter you bump adds to your damage score and knocks you back, so
          a clean climb is faster.
        </p>
      </div>
    </section>
  );
};

"use client";
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";

// A drawing surface for the customer to sign on, by finger or mouse. It keeps no state outside the canvas; the parent
// asks for the picture when the customer confirms. The picture is a PNG on a white background, at most about 600 by
// 220 pixels, so it stays small enough for the database's limit (app.rep_attach_signature: 200 bytes to 120,000).
export type SignaturePadHandle = { toPng: () => string | null; clear: () => void };

const WIDTH = 600;
const HEIGHT = 220;
const LINE_WIDTH = 3;
const MIN_POINTS = 8;
// A tap draws a dot: a line of this length, so a single touch leaves a mark.
const DOT = 0.01;
const PNG_PREFIX = "data:image/png;base64,";

// Blank white paper and the pen, with no state: used on mount and by the clear button.
function paint(c: HTMLCanvasElement | null) {
  const g = c?.getContext("2d");
  if (!c || !g) return;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = "#111111";
  g.lineWidth = LINE_WIDTH;
  g.lineCap = "round";
  g.lineJoin = "round";
}

export function SignaturePad({ ref, onInk }: { ref: Ref<SignaturePadHandle>; onInk?: (hasInk: boolean) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const points = useRef(0);
  const [hasInk, setHasInk] = useState(false);

  const reset = () => {
    paint(canvas.current);
    points.current = 0;
    setHasInk(false);
    onInk?.(false);
  };

  useEffect(() => {
    paint(canvas.current);
  }, []);

  useImperativeHandle(ref, () => ({
    toPng: () => {
      const c = canvas.current;
      if (!c || points.current < MIN_POINTS) return null;
      const url = c.toDataURL("image/png");
      return url.startsWith(PNG_PREFIX) ? url.slice(PNG_PREFIX.length) : null;
    },
    clear: reset,
  }));

  // The position of a pointer in canvas pixels, whatever size the canvas is drawn at.
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  };

  return (
    <canvas
      ref={canvas}
      width={WIDTH}
      height={HEIGHT}
      aria-label="Signature area"
      data-testid="signature-pad"
      style={{
        width: "100%",
        maxWidth: WIDTH,
        aspectRatio: `${WIDTH} / ${HEIGHT}`,
        border: "2px dashed var(--border)",
        borderRadius: 8,
        background: "#fff",
        touchAction: "none",
      }}
      onPointerDown={(e) => {
        const g = canvas.current?.getContext("2d");
        if (!g) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drawing.current = true;
        const p = at(e);
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x + DOT, p.y + DOT);
        g.stroke();
        points.current += 1;
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return;
        const g = canvas.current?.getContext("2d");
        if (!g) return;
        const p = at(e);
        g.lineTo(p.x, p.y);
        g.stroke();
        points.current += 1;
        if (!hasInk && points.current >= MIN_POINTS) {
          setHasInk(true);
          onInk?.(true);
        }
      }}
      onPointerUp={() => {
        drawing.current = false;
      }}
      onPointerCancel={() => {
        drawing.current = false;
      }}
    />
  );
}

"use client";

import { useRef, useState, type PointerEvent } from "react";
import { Eraser } from "lucide-react";

/** Pad de firma: el usuario dibuja y se serializa a PNG en un input oculto. */
export function SignaturePad({ name }: { name: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  function ctx() {
    return canvasRef.current?.getContext("2d") ?? null;
  }

  function point(e: PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = canvasRef.current!.width / rect.width;
    const scaleY = canvasRef.current!.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function sync() {
    if (hiddenRef.current && canvasRef.current) {
      hiddenRef.current.value = canvasRef.current.toDataURL("image/png");
    }
  }

  function start(e: PointerEvent<HTMLCanvasElement>) {
    const c = ctx();
    if (!c) return;
    drawing.current = true;
    try {
      canvasRef.current!.setPointerCapture(e.pointerId);
    } catch {
      // setPointerCapture puede fallar con punteros sintéticos; no es crítico.
    }
    const { x, y } = point(e);
    c.beginPath();
    c.moveTo(x, y);
    c.lineWidth = 2.5;
    c.lineCap = "round";
    c.strokeStyle = "#0a2540";
  }

  function move(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const c = ctx();
    if (!c) return;
    const { x, y } = point(e);
    c.lineTo(x, y);
    c.stroke();
    setHasDrawn(true);
    sync();
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    sync();
  }

  function clear() {
    const c = ctx();
    if (!c || !canvasRef.current) return;
    c.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setHasDrawn(false);
    if (hiddenRef.current) hiddenRef.current.value = "";
  }

  return (
    <div className="space-y-2">
      <div className="relative rounded-lg border border-input bg-white">
        <canvas
          ref={canvasRef}
          width={600}
          height={200}
          className="h-[200px] w-full touch-none rounded-lg"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
        {!hasDrawn && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Firma aquí
          </span>
        )}
        <button
          type="button"
          onClick={clear}
          className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-cloud px-2 py-1 text-xs text-muted-foreground hover:text-navy"
        >
          <Eraser className="size-3" />
          Borrar
        </button>
      </div>
      <input ref={hiddenRef} type="hidden" name={name} />
    </div>
  );
}

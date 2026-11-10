"use client";
import { Eraser } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const INK = "#111827";
const WIDTH = 600;
const HEIGHT = 200;

export type SignatureMode = "draw" | "type";

export interface SignatureState {
  mode: SignatureMode;
  name: string;
  hasInk: boolean;
}

/** Renders the signature as a PNG: the drawing, or the typed name in a handwriting-style font. */
export async function signatureBlob(state: SignatureState, canvas: HTMLCanvasElement | null): Promise<Blob | null> {
  let source = canvas;
  if (state.mode === "type") {
    source = document.createElement("canvas");
    source.width = WIDTH;
    source.height = HEIGHT;
    const ctx = source.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let size = 64;
    do {
      ctx.font = `italic ${size}px "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive`;
      size -= 4;
    } while (ctx.measureText(state.name).width > WIDTH - 40 && size > 20);
    ctx.fillText(state.name, WIDTH / 2, HEIGHT / 2);
  }
  if (!source) return null;
  return new Promise((resolve) => source!.toBlob((b) => resolve(b), "image/png"));
}

/**
 * Signature capture (JOB-10): draw with a finger, pen or mouse, or type the name for a handwriting-style
 * signature, so keyboard and screen-reader users can sign too.
 */
export function SignaturePad({
  state,
  onChange,
  canvasRef,
}: {
  state: SignatureState;
  onChange: (next: SignatureState) => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}) {
  const t = useTranslations("fieldwork.signature");
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const reset = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [canvasRef]);

  useEffect(() => {
    if (state.mode !== "draw") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    reset();
  }, [state.mode, canvasRef, reset]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * WIDTH, y: ((e.clientY - rect.top) / rect.height) * HEIGHT };
  };
  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="signer-name">{t("signerName")}</Label>
        <Input
          id="signer-name"
          autoComplete="name"
          maxLength={120}
          value={state.name}
          onChange={(e) => onChange({ ...state, name: e.target.value })}
        />
      </div>
      <RadioGroup
        value={state.mode}
        onValueChange={(v) => onChange({ ...state, mode: v as SignatureMode })}
        className="grid grid-cols-2 gap-2"
        aria-label={t("modeLabel")}
      >
        {(["draw", "type"] as const).map((m) => (
          <label key={m} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <RadioGroupItem value={m} /> {t(`mode.${m}`)}
          </label>
        ))}
      </RadioGroup>
      {state.mode === "draw" ? (
        <div className="space-y-1.5">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={t("padLabel")}
            data-testid="signature-pad"
            className="aspect-[3/1] w-full touch-none rounded-md border-2 border-dashed bg-white"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drawing.current = true;
              last.current = point(e);
              stroke(last.current, { x: last.current.x + 0.1, y: last.current.y + 0.1 });
              if (!state.hasInk) onChange({ ...state, hasInk: true });
            }}
            onPointerMove={(e) => {
              if (!drawing.current || !last.current) return;
              const p = point(e);
              stroke(last.current, p);
              last.current = p;
            }}
            onPointerUp={() => {
              drawing.current = false;
              last.current = null;
            }}
            onPointerCancel={() => {
              drawing.current = false;
              last.current = null;
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">{t("padHint")}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!state.hasInk}
              onClick={() => {
                reset();
                onChange({ ...state, hasInk: false });
              }}
            >
              <Eraser /> {t("clear")}
            </Button>
          </div>
        </div>
      ) : (
        <div
          className="flex aspect-[3/1] w-full items-center justify-center overflow-hidden rounded-md border bg-white px-4 text-4xl text-gray-900 italic"
          style={{ fontFamily: '"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive' }}
          aria-hidden
        >
          {state.name || <span className="text-base text-gray-600 not-italic">{t("typePreview")}</span>}
        </div>
      )}
    </div>
  );
}

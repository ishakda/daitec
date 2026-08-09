"use client";
import { useRef, useState, useEffect, useCallback } from "react";
import { Camera, Eraser, PackageCheck, QrCode, CheckCircle2 } from "lucide-react";
import { useI18n } from "./I18nProvider";
import { Button, Modal } from "./ui";
import { QrScanner } from "./QrKit";
import { apiFetch, ClientApiError } from "@/lib/client";

export type Proof = { kind: "photo" | "signature"; data: string };

/** Downscale + compress an image file to a JPEG data-URL (≤ maxDim px). */
async function compressImage(file: File, maxDim = 1000, quality = 0.72): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** Touch/pen/mouse signature pad. */
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = "#14263f";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const emit = useCallback(() => {
    onChange(hasInk || drawing.current ? canvasRef.current!.toDataURL("image/png") : null);
  }, [hasInk, onChange]);

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="h-40 w-full touch-none rounded-lg border border-line-2 bg-white"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const ctx = canvasRef.current!.getContext("2d")!;
          const { x, y } = pos(e);
          ctx.beginPath(); ctx.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvasRef.current!.getContext("2d")!;
          const { x, y } = pos(e);
          ctx.lineTo(x, y); ctx.stroke();
          if (!hasInk) setHasInk(true);
        }}
        onPointerUp={() => { drawing.current = false; emit(); }}
      />
      <button
        type="button"
        onClick={() => {
          const canvas = canvasRef.current!;
          const ctx = canvas.getContext("2d")!;
          ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.restore();
          setHasInk(false); onChange(null);
        }}
        className="mt-1.5 flex items-center gap-1 text-xs text-ink-3 hover:text-danger"
      >
        <Eraser size={12} /> {t("delivery.pod_clearSignature")}
      </button>
    </div>
  );
}

/** Modal shown when the livreur confirms a delivery: QR + photo + signature. */
export function PodModal({ number, deliveryId, hasCustomer, onClose, onConfirm }: {
  number: string;
  deliveryId?: string;
  hasCustomer?: boolean;
  onClose: () => void;
  onConfirm: (proofs: Proof[], qrToken?: string | null) => Promise<void>;
}) {
  const { t } = useI18n();
  const [photo, setPhoto] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrName, setQrName] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function confirm() {
    setLoading(true);
    const proofs: Proof[] = [];
    if (photo) proofs.push({ kind: "photo", data: photo });
    if (signature) proofs.push({ kind: "signature", data: signature });
    await onConfirm(proofs, qrToken);
  }

  async function handleScan(payload: string) {
    setScanOpen(false);
    setQrError(null);
    if (!deliveryId) { setQrToken(payload); return; }
    try {
      const r = await apiFetch<{ ok: boolean; customerName: string | null }>(
        `/deliveries/${deliveryId}/verify-qr`, { method: "POST", json: { token: payload } });
      setQrToken(payload);
      setQrName(r.customerName);
    } catch (e) {
      setQrToken(null); setQrName(null);
      setQrError(e instanceof ClientApiError && e.code === "QR_MISMATCH" ? t("qr.mismatch") : t("common.errorGeneric"));
    }
  }

  return (
    <Modal open onClose={onClose} title={`${t("delivery.pod")} — ${number}`}>
      <div className="space-y-4">
        {hasCustomer && (
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-ink-2">{t("qr.title")}</p>
            {qrToken ? (
              <p className="flex items-center gap-2 rounded-lg bg-ok-soft px-3 py-2.5 text-[13.5px] font-semibold text-ok">
                <CheckCircle2 size={17} /> {t("qr.verified")}{qrName ? ` — ${qrName}` : ""}
              </p>
            ) : (
              <Button type="button" variant="secondary" className="h-11 w-full" onClick={() => setScanOpen(true)}>
                <QrCode size={16} /> {t("qr.scan")}
              </Button>
            )}
            {qrError && <p className="mt-1.5 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{qrError}</p>}
          </div>
        )}
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink-2">{t("delivery.pod_photo")}</p>
          <input
            ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setPhoto(await compressImage(f));
              e.target.value = "";
            }}
          />
          {photo ? (
            <div className="space-y-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="" className="max-h-48 w-full rounded-lg border border-line object-cover" />
              <button type="button" onClick={() => fileRef.current?.click()}
                className="text-xs text-accent hover:underline">
                {t("delivery.pod_retakePhoto")}
              </button>
            </div>
          ) : (
            <Button type="button" variant="secondary" className="h-11 w-full" onClick={() => fileRef.current?.click()}>
              <Camera size={16} /> {t("delivery.pod_takePhoto")}
            </Button>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink-2">{t("delivery.pod_signature")}</p>
          <p className="mb-1.5 text-xs text-ink-3">{t("delivery.pod_signHere")}</p>
          <SignaturePad onChange={setSignature} />
        </div>

        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={confirm} disabled={loading}
            className="text-[12.5px] text-ink-3 underline-offset-2 hover:underline disabled:opacity-50">
            {t("delivery.pod_skip")}
          </button>
          <Button className="h-11 flex-1" loading={loading}
            disabled={!photo && !signature && !qrToken} onClick={confirm}>
            <PackageCheck size={16} /> {t("delivery.pod_confirmDelivered")}
          </Button>
        </div>
      </div>
      {scanOpen && <QrScanner onScan={handleScan} onClose={() => setScanOpen(false)} />}
    </Modal>
  );
}

/** Read-only proof viewer (dispatcher side). */
export function ProofViewer({ deliveryId, number, onClose }: {
  deliveryId: string; number: string; onClose: () => void;
}) {
  const { t, formatDateTime } = useI18n();
  const [proofs, setProofs] = useState<Array<{ id: string; kind: string; data: string; created_at: string; created_by_name: string | null }> | null>(null);

  useEffect(() => {
    fetch(`/api/v1/deliveries/${deliveryId}/proofs`)
      .then((r) => r.json())
      .then((d) => setProofs(d.data ?? []))
      .catch(() => setProofs([]));
  }, [deliveryId]);

  return (
    <Modal open onClose={onClose} title={`${t("delivery.pod")} — ${number}`} wide>
      {proofs == null ? (
        <p className="py-8 text-center text-sm text-ink-3">{t("common.loading")}</p>
      ) : proofs.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-3">{t("delivery.pod_none")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {proofs.map((p) => (
            <figure key={p.id}>
              <figcaption className="mb-1.5 text-[13px] font-medium text-ink-2">
                {p.kind === "photo" ? t("delivery.pod_photo") : t("delivery.pod_signature")}
              </figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.data} alt={p.kind}
                className={`w-full rounded-lg border border-line ${p.kind === "signature" ? "bg-white" : "object-cover"}`} />
              <p className="mt-1 text-xs text-ink-3">
                {t("delivery.pod_attachedBy")} {p.created_by_name ?? "—"} · {formatDateTime(p.created_at)}
              </p>
            </figure>
          ))}
        </div>
      )}
    </Modal>
  );
}

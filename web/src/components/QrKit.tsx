"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { QrCode, Printer, X } from "lucide-react";
import { useI18n } from "./I18nProvider";
import { Button } from "./ui";

/** Payload format printed on customer cards: DAITEC:CUST:<token> */
export const qrPayload = (token: string) => `DAITEC:CUST:${token}`;

/* ------------------------------------------------------------------ */
/* Customer QR card: render + print (A6-style card the shop hands out) */
/* ------------------------------------------------------------------ */
export function CustomerQrCard({ token, customerName, companyName }: {
  token: string; customerName: string; companyName?: string;
}) {
  const { t } = useI18n();
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    QRCode.toDataURL(qrPayload(token), { width: 480, margin: 1, errorCorrectionLevel: "M" })
      .then(setDataUrl).catch(() => setDataUrl(null));
  }, [token]);

  function print() {
    if (!dataUrl) return;
    const w = window.open("", "_blank", "width=440,height=620");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>QR</title>
      <style>
        body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:96vh;margin:0}
        .card{border:1.5px solid #14263f;border-radius:14px;padding:26px 30px;text-align:center;width:300px}
        img{width:230px;height:230px}
        h2{margin:2px 0 0;font-size:17px;color:#14263f}
        p{margin:4px 0 12px;font-size:12px;color:#667085}
        .foot{font-size:10.5px;color:#98a2b3;margin-top:10px}
        @media print{ body{min-height:auto} }
      </style></head><body>
      <div class="card">
        <h2>${(companyName ?? "Daitec").replace(/</g, "&lt;")}</h2>
        <p>${t("qr.cardHint")}</p>
        <img src="${dataUrl}" alt="QR" />
        <h2 style="font-size:15px">${customerName.replace(/</g, "&lt;")}</h2>
        <div class="foot">Daitec — ${t("qr.title")}</div>
      </div>
      <script>setTimeout(()=>window.print(),250)</script>
      </body></html>`);
    w.document.close();
  }

  return (
    <div className="flex items-center gap-4">
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt="QR" className="h-28 w-28 rounded-lg border border-line" />
      ) : (
        <div className="skeleton h-28 w-28" />
      )}
      <div className="space-y-2">
        <p className="max-w-[220px] text-[12.5px] text-ink-3">{t("qr.cardHint")}</p>
        <Button variant="secondary" className="h-8" onClick={print} disabled={!dataUrl}>
          <Printer size={14} /> {t("qr.print")}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Camera QR scanner (jsQR frame loop) — phone-first full overlay      */
/* ------------------------------------------------------------------ */
export function QrScanner({ onScan, onClose }: {
  onScan: (payload: string) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false; // effect may re-run (StrictMode) — reset the flag
    let cancelled = false;
    let stream: MediaStream | null = null;
    let raf = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 } },
        });
        if (cancelled || stopped.current) { stream.getTracks().forEach((t2) => t2.stop()); return; }
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setError(false);
        const tick = () => {
          if (stopped.current) return;
          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
            if (code?.data) {
              stopped.current = true;
              onScan(code.data);
              return;
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        if (!cancelled && !stopped.current) setError(true);
      }
    }
    start();
    return () => {
      cancelled = true;
      stopped.current = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t2) => t2.stop());
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="flex items-center gap-2 text-sm font-medium"><QrCode size={16} /> {t("qr.scanTitle")}</span>
        <button onClick={onClose} className="rounded-lg p-2 hover:bg-white/10"><X size={18} /></button>
      </div>
      <div className="relative flex-1">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-56 w-56 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        </div>
        {error && (
          <p className="absolute inset-x-4 top-4 rounded-lg bg-danger px-3 py-2 text-center text-[13px] text-white">
            {t("qr.cameraDenied")}
          </p>
        )}
      </div>
      <p className="px-4 py-3 text-center text-[13px] text-white/70">{t("qr.scanHint")}</p>
    </div>
  );
}

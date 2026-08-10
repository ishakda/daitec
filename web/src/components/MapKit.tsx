"use client";
/**
 * Leaflet map kit (OpenStreetMap tiles — no API key).
 * Client-only: pages must import via next/dynamic with ssr: false.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export const ALGIERS: [number, number] = [36.7538, 3.0588];

/** Colored pin markers built with divIcon (no image asset issues in Next). */
export function pin(color: string, glyph = "") {
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:26px;height:34px">
      <svg width="26" height="34" viewBox="0 0 26 34">
        <path d="M13 0C5.8 0 0 5.8 0 13c0 9.8 13 21 13 21s13-11.2 13-21C26 5.8 20.2 0 13 0z" fill="${color}"/>
        <circle cx="13" cy="12.5" r="8.5" fill="white"/>
      </svg>
      <span style="position:absolute;top:5.5px;left:0;width:26px;text-align:center;font-size:11px;font-weight:700;color:${color};font-family:system-ui">${glyph}</span>
    </div>`,
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -30],
  });
}

export function dot(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export const COLORS = {
  store: "#14263f", warehouse: "#1d3a5f", customer: "#0e7569",
  debt: "#b54708", courier: "#175cd3",
  pending: "#98a2b3", assigned: "#175cd3", picked_up: "#b54708",
  out_for_delivery: "#7a5af8", delivered: "#067647", failed: "#b42318",
};

export function BaseMap({
  center = ALGIERS, zoom = 12, children, className = "h-full w-full",
}: {
  center?: [number, number]; zoom?: number; children?: React.ReactNode; className?: string;
}) {
  return (
    <MapContainer center={center} zoom={zoom} className={className} scrollWheelZoom
      zoomAnimation={false} fadeAnimation={false} markerZoomAnimation={false}
      attributionControl>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {children}
    </MapContainer>
  );
}

/** True while the Leaflet map is alive and attached to the DOM. */
function mapAlive(map: L.Map): boolean {
  try {
    const el = map.getContainer();
    // @ts-expect-error _leaflet_id is Leaflet-internal but the reliable liveness check
    return !!el && el.isConnected && !!map._leaflet_id;
  } catch {
    return false;
  }
}

/** Run a Leaflet view operation safely (map may unmount mid-animation). */
function safeView(map: L.Map, fn: () => void) {
  if (!mapAlive(map)) return;
  try {
    map.stop(); // cancel any in-flight pan/zoom animation first
    fn();
  } catch {
    /* map torn down between the check and the call — ignore */
  }
}

/**
 * Fit map to the data ONCE per mount (first non-empty set of points).
 * Polling updates must not re-yank the viewport nor animate into a
 * potentially-unmounting container (the "_leaflet_pos" crash).
 */
export function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  const fitted = useRef(false);
  const key = useMemo(() => points.map((p) => p.join(",")).join(";"), [points]);
  useEffect(() => {
    if (fitted.current || points.length === 0) return;
    fitted.current = true;
    safeView(map, () => {
      if (points.length === 1) map.setView(points[0], 14, { animate: false });
      else map.fitBounds(L.latLngBounds(points.map(([a, b]) => L.latLng(a, b))),
        { padding: [40, 40], animate: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

function ClickCapture({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

type NominatimHit = { display_name: string; lat: string; lon: string };

/**
 * Location picker: click the map to drop a pin, or search an address
 * (Nominatim, debounced, DZ-biased).
 */
export function LocationPicker({
  value, onChange, searchPlaceholder,
}: {
  value: { lat: number; lng: number } | null;
  onChange: (v: { lat: number; lng: number } | null) => void;
  searchPlaceholder: string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<NominatimHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (q.trim().length < 3) { setHits([]); return; }
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=dz&q=${encodeURIComponent(q)}`,
          { headers: { "accept-language": "fr" } }
        );
        setHits(res.ok ? await res.json() : []);
      } catch { setHits([]); }
      finally { setSearching(false); }
    }, 450);
    return () => clearTimeout(id);
  }, [q]);

  const center: [number, number] = value ? [value.lat, value.lng] : ALGIERS;

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-9 w-full rounded-lg border border-line-2 bg-surface px-3 text-sm outline-none focus:border-accent"
        />
        {searching && <span className="absolute end-3 top-2 text-xs text-ink-3">…</span>}
        {hits.length > 0 && (
          <div className="absolute z-[1000] mt-1 w-full rounded-lg border border-line bg-surface shadow-pop">
            {hits.map((h, i) => (
              <button key={i} type="button"
                onClick={() => { onChange({ lat: Number(h.lat), lng: Number(h.lon) }); setHits([]); setQ(""); }}
                className="block w-full truncate px-3 py-2 text-start text-[12.5px] hover:bg-canvas">
                {h.display_name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="h-64 overflow-hidden rounded-lg border border-line" dir="ltr">
        <BaseMap center={center} zoom={value ? 15 : 11}>
          <ClickCapture onPick={(lat, lng) => onChange({ lat, lng })} />
          {value && <Marker position={[value.lat, value.lng]} icon={pin(COLORS.customer)} />}
          {value && <Recenter lat={value.lat} lng={value.lng} />}
        </BaseMap>
      </div>
      {value && (
        <p className="num text-xs text-ink-3">
          {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
          <button type="button" onClick={() => onChange(null)} className="ms-2 text-danger hover:underline">✕</button>
        </p>
      )}
    </div>
  );
}

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    safeView(map, () => map.setView([lat, lng], Math.max(map.getZoom(), 14), { animate: false }));
  }, [lat, lng, map]);
  return null;
}

export { Marker, Popup };

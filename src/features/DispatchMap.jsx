import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

const DEFAULT_CENTER = [37.34, -121.89];
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const TECH_FILL = '#818cf8';
const JOB_FILL = { Pending: '#fbbf24', 'Ready for Signoff': '#fb923c' };
const DEFAULT_JOB_FILL = '#2dd4bf';

const hasCoords = (item) => Number.isFinite(item.lat) && Number.isFinite(item.lng);

const buildPopup = (lines) => {
  const root = document.createElement('div');
  lines.filter(Boolean).forEach(({ text, strong }) => {
    const line = document.createElement(strong ? 'strong' : 'div');
    line.textContent = text;
    root.appendChild(line);
  });
  return root;
};

export default function DispatchMap({ jobs }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const hasFittedRef = useRef(false);
  const [technicians, setTechnicians] = useState([]);

  useEffect(() => onSnapshot(
    collection(db, 'technicians'),
    (snapshot) => setTechnicians(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
    (error) => console.error('Unable to load technician locations', error),
  ), []);

  useEffect(() => {
    const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView(DEFAULT_CENTER, 10);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      hasFittedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const points = [];
    const addMarker = ({ lat, lng }, fill, lines) => {
      const marker = L.circleMarker([lat, lng], { radius: 8, weight: 2, color: '#0f172a', fillColor: fill, fillOpacity: 0.95 });
      marker.bindPopup(buildPopup(lines));
      marker.addTo(layer);
      points.push([lat, lng]);
    };

    technicians.filter(hasCoords).forEach((tech) => addMarker(tech, TECH_FILL, [
      { text: tech.name || tech.email || 'Technician', strong: true },
      { text: 'Base location' },
      { text: tech.location || '' },
    ]));

    jobs.filter(hasCoords).forEach((job) => addMarker(job, JOB_FILL[job.status] || DEFAULT_JOB_FILL, [
      { text: job.client || 'Unnamed client', strong: true },
      { text: job.task || 'Service' },
      { text: job.status || '' },
      { text: job.assignedTechName ? `Tech: ${job.assignedTechName}` : 'Unassigned' },
      { text: job.location || '' },
    ]));

    if (points.length && !hasFittedRef.current) {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 13 });
      hasFittedRef.current = true;
    }
  }, [jobs, technicians]);

  return (
    <section className="grid gap-4">
      <div className="rounded-3xl bg-slate-800 border border-slate-700 p-4">
        <h2 className="text-xl font-semibold text-white">Dispatch map</h2>
        <p className="text-slate-400 text-sm mt-1">
          Open jobs (amber pending, teal dispatched, orange awaiting sign-off) and technician base locations (purple).
        </p>
      </div>
      <div ref={containerRef} className="h-[460px] w-full rounded-3xl overflow-hidden border border-slate-700" />
    </section>
  );
}

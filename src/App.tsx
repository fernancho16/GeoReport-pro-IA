import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FileText, MapPin, Navigation, Terminal, Copy, Check, Loader2, Sparkles, History, Layout, FileCode, ChevronRight, Share2, Play, Map as MapIcon, LocateFixed, Globe, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin as GooglePin, useMap as useGoogleMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

// Leaflet fix for default markers
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom Premium DivIcons for Maps
export const startIcon = typeof window !== 'undefined' ? L.divIcon({
  className: 'custom-div-icon',
  html: `<div style="width: 16px; height: 16px; background-color: #1e293b; border-radius: 50%; border: 2px solid white; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); outline: 4px solid rgba(30, 41, 59, 0.2);"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
}) : null;

export const endIcon = typeof window !== 'undefined' ? L.divIcon({
  className: 'custom-div-icon',
  html: `<div style="width: 16px; height: 16px; background-color: #2563eb; border-radius: 50%; border: 2px solid white; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); outline: 4px solid rgba(37, 99, 235, 0.2);"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
}) : null;

export const greenIcon = typeof window !== 'undefined' ? L.divIcon({
  className: 'custom-div-icon',
  html: `<div style="width: 16px; height: 16px; background-color: #059669; border-radius: 50%; border: 2px solid white; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); outline: 4px solid rgba(5, 150, 105, 0.2);"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
}) : null;

const API_KEY = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';

interface GenerationResponse {
  report: string;
  code: string;
  execution_instructions: string;
  projectName?: string;
  vereda?: string;
  convenioNumber?: string;
  startCoords?: { lat: number; lng: number };
  endCoords?: { lat: number; lng: number };
  _provider?: string;
}

interface ProviderOption {
  id: string;
  name: string;
  configured: boolean;
  supportsFiles: boolean;
}

interface AdditionalMarker {
  id: string;
  lat: string;
  lng: string;
  label: string;
}

// Validate that coordinates are real numbers
const hasValidCoords = (c: any): c is { lat: number; lng: number } =>
  c != null &&
  typeof c.lat === 'number' && !isNaN(c.lat) &&
  typeof c.lng === 'number' && !isNaN(c.lng);

// Sanitize API response — prevent undefined fields from crashing the render
const sanitizeResult = (data: any): GenerationResponse => ({
  report: typeof data.report === 'string' ? data.report : (data.report ? JSON.stringify(data.report) : 'Sin contenido generado.'),
  code: typeof data.code === 'string' ? data.code : '',
  execution_instructions: typeof data.execution_instructions === 'string' ? data.execution_instructions : '',
  projectName: data.projectName || '',
  vereda: data.vereda || '',
  convenioNumber: data.convenioNumber || '',
  startCoords: hasValidCoords(data.startCoords) ? data.startCoords : undefined,
  endCoords: hasValidCoords(data.endCoords) ? data.endCoords : undefined,
  _provider: data._provider,
});

function RoutePolyline({ start, end }: { start: google.maps.LatLngLiteral; end: google.maps.LatLngLiteral }) {
  const map = useGoogleMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    if (!routesLib || !map || !start || !end) return;

    // Clear previous polylines
    polylinesRef.current.forEach(p => p.setMap(null));
    polylinesRef.current = [];

    routesLib.Route.computeRoutes({
      origin: start,
      destination: end,
      travelMode: 'DRIVING',
      fields: ['path', 'viewport'],
    }).then(({ routes }) => {
      if (routes?.[0]) {
        const newPolylines = routes[0].createPolylines();
        newPolylines.forEach(p => p.setMap(map));
        polylinesRef.current = newPolylines;
        if (routes[0].viewport) {
          map.fitBounds(routes[0].viewport);
        }
      }
    }).catch(err => console.error("Error computing route:", err));

    return () => polylinesRef.current.forEach(p => p.setMap(null));
  }, [routesLib, map, start, end]);

  return null;
}

// Leaflet helper to update view
function ChangeView({ center, zoom, mapRef }: { center: [number, number], zoom: number, mapRef?: any }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
    if (mapRef) {
      mapRef.current = map;
    }
  }, [center, zoom, map, mapRef]);
  return null;
}

// Leaflet Routing Component using OSRM
function LeafletRouting({ start, end }: { start: [number, number], end: [number, number] }) {
  const map = useMap();
  const [route, setRoute] = useState<[number, number][]>([]);

  const startKey = `${start[0]},${start[1]}`;
  const endKey = `${end[0]},${end[1]}`;

  useEffect(() => {
    if (!start || !end) return;
    
    // Using OSRM public demo server
    fetch(`https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`)
      .then(res => res.json())
      .then(data => {
        if (data.routes && data.routes[0]) {
          const coords = data.routes[0].geometry.coordinates.map((c: any) => [c[1], c[0]]);
          setRoute(coords);
          
          // Fit bounds
          const bounds = L.latLngBounds([start, end]);
          map.fitBounds(bounds, { padding: [50, 50] });
        }
      })
      .catch(err => {
        console.error("OSRM Error:", err);
        setRoute([start, end]);
      });
  }, [startKey, endKey, map]);

  return route.length > 0 ? <Polyline positions={route} color="#2563eb" weight={4} opacity={0.7} /> : null;
}

// Coordinate Grid Component
function getGridStep(zoom: number) {
  if (zoom > 15) return 0.002;
  if (zoom > 13) return 0.01;
  if (zoom > 10) return 0.1;
  return 1;
}

function getGridData(bounds: L.LatLngBounds, zoom: number) {
  const step = getGridStep(zoom);
  const lines: [number, number][][] = [];
  const latLabels: { pos: [number, number]; text: string }[] = [];
  const lngLabels: { pos: [number, number]; text: string }[] = [];

  const north = bounds.getNorth();
  const south = bounds.getSouth();
  const east = bounds.getEast();
  const west = bounds.getWest();

  const startLat = Math.floor(south / step) * step;
  for (let lat = startLat; lat <= north; lat += step) {
    const roundedLat = Number(lat.toFixed(10));
    lines.push([[roundedLat, west], [roundedLat, east]]);
    latLabels.push({ pos: [roundedLat, west], text: roundedLat.toFixed(4) + '°' });
  }

  const startLng = Math.floor(west / step) * step;
  for (let lng = startLng; lng <= east; lng += step) {
    const roundedLng = Number(lng.toFixed(10));
    lines.push([[south, roundedLng], [north, roundedLng]]);
    lngLabels.push({ pos: [south, roundedLng], text: roundedLng.toFixed(4) + '°' });
  }

  return { lines, latLabels, lngLabels };
}

function CoordinateGrid({ useSatellite }: { useSatellite?: boolean }) {
  const map = useMap();
  const [bounds, setBounds] = useState(() => map.getBounds());

  useEffect(() => {
    const update = () => setBounds(map.getBounds());
    map.on('moveend', update);
    map.on('zoomend', update);
    return () => {
      map.off('moveend', update);
      map.off('zoomend', update);
    };
  }, [map]);

  const zoom = map.getZoom();
  const { lines, latLabels, lngLabels } = getGridData(bounds, zoom);
  const mapContainer = map.getContainer();

  const color = useSatellite ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.2)';
  const textColor = useSatellite ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.7)';
  const textShadow = useSatellite ? '0px 0px 2px #000' : '0px 0px 2px #fff';

  return (
    <>
      {lines.map((pos, i) => (
        <Polyline key={i} positions={pos} color={color} weight={1} dashArray="4 4" interactive={false} />
      ))}
      {mapContainer && createPortal(
        <div className="grid-label-overlay" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 450 }}>
          {latLabels.map((lbl, i) => {
            const point = map.latLngToContainerPoint(lbl.pos);
            return (
              <div
                key={`lat-${i}`}
                className="lat-label-text"
                style={{
                  position: 'absolute',
                  left: `${point.x + 6}px`,
                  top: `${point.y}px`,
                  color: textColor,
                  textShadow,
                  fontSize: '16px',
                  fontWeight: 'bold',
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                  transform: 'translateY(-50%)',
                }}
              >
                {lbl.text}
              </div>
            );
          })}
          {lngLabels.map((lbl, i) => {
            const point = map.latLngToContainerPoint(lbl.pos);
            return (
              <div
                key={`lng-${i}`}
                className="lng-label-text"
                style={{
                  position: 'absolute',
                  left: `${point.x}px`,
                  top: `${point.y}px`,
                  color: textColor,
                  textShadow,
                  fontSize: '16px',
                  fontWeight: 'bold',
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                  transformOrigin: '0 50%',
                  transform: 'rotate(-90deg) translateX(10px)',
                }}
              >
                {lbl.text}
              </div>
            );
          })}
        </div>,
        mapContainer
      )}
    </>
  );
}

// Error Boundary to prevent full blank screen on runtime errors
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-slate-50 text-slate-800 p-8">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-8 max-w-lg text-center shadow-lg">
            <h2 className="text-lg font-bold text-red-700 mb-2">Error de renderizado</h2>
            <p className="text-sm text-red-600 font-mono">{this.state.error}</p>
            <button onClick={() => window.location.reload()} className="mt-6 px-4 py-2 bg-red-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-red-700 transition">
              Recargar App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [description, setDescription] = useState('');
  const [projectName, setProjectName] = useState('');
  
  // Decimal states (used for API and Map)
  const [startLat, setStartLat] = useState('');
  const [startLng, setStartLng] = useState('');
  const [endLat, setEndLat] = useState('');
  const [endLng, setEndLng] = useState('');

  // States for additional position markers (Maps 2 & 3)
  const [image2Markers, setImage2Markers] = useState<AdditionalMarker[]>([
    { id: 'm2-1', lat: '', lng: '', label: 'Marca A1' },
    { id: 'm2-2', lat: '', lng: '', label: 'Marca A2' }
  ]);
  const [image3Markers, setImage3Markers] = useState<AdditionalMarker[]>([
    { id: 'm3-1', lat: '', lng: '', label: 'Marca B1' },
    { id: 'm3-2', lat: '', lng: '', label: 'Marca B2' }
  ]);
  const [showAdditionalMarkers, setShowAdditionalMarkers] = useState(false);
  const [activeMarkerTab, setActiveMarkerTab] = useState<'A' | 'B'>('A');

  const addMarker2 = () => {
    setImage2Markers(prev => [...prev, { id: Math.random().toString(36).substring(7), lat: '', lng: '', label: `Marca A${prev.length + 1}` }]);
  };
  const removeMarker2 = (id: string) => {
    setImage2Markers(prev => prev.filter(m => m.id !== id));
  };
  const updateMarker2 = (id: string, field: keyof AdditionalMarker, value: string) => {
    setImage2Markers(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  const addMarker3 = () => {
    setImage3Markers(prev => [...prev, { id: Math.random().toString(36).substring(7), lat: '', lng: '', label: `Marca B${prev.length + 1}` }]);
  };
  const removeMarker3 = (id: string) => {
    setImage3Markers(prev => prev.filter(m => m.id !== id));
  };
  const updateMarker3 = (id: string, field: keyof AdditionalMarker, value: string) => {
    setImage3Markers(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  // DMS states
  const [useDMS, setUseDMS] = useState(false);
  // Base layer selector: 'osm' | 'esri-imagery' | 'esri-clarity' | 'esri-topo' | 'carto-light' | 'carto-dark' | 'google-sat'
  const [baseLayer, setBaseLayer] = useState<string>('osm');
  const useSatellite = baseLayer !== 'osm' && baseLayer !== 'esri-topo' && baseLayer !== 'carto-light';

  const BASE_LAYERS: { id: string; label: string; url: string; attribution: string; maxZoom?: number }[] = [
    {
      id: 'osm',
      label: 'OpenStreetMap',
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
    {
      id: 'esri-imagery',
      label: 'Satélite Esri',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri &mdash; Esri, USDA, USGS, AEX, GeoEye, IGN',
    },
    {
      id: 'esri-clarity',
      label: 'Esri Clarity (sin nubes)',
      url: 'https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics',
      maxZoom: 19,
    },
    {
      id: 'google-sat',
      label: 'Google Satélite',
      url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      attribution: '&copy; Google Maps',
      maxZoom: 20,
    },
    {
      id: 'esri-topo',
      label: 'Esri Topo',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC',
    },
    {
      id: 'carto-light',
      label: 'CartoDB Claro',
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    },
    {
      id: 'carto-dark',
      label: 'CartoDB Oscuro',
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    },
  ];
  const [forceFreeMap, setForceFreeMap] = useState(() => localStorage.getItem('forceFreeMap') === 'true');
  const [dmsStartFull, setDmsStartFull] = useState('');
  const [dmsEndFull, setDmsEndFull] = useState('');
  const [dmsStartLat, setDmsStartLat] = useState({ d: '', m: '', s: '', dir: 'N' });
  const [dmsStartLng, setDmsStartLng] = useState({ d: '', m: '', s: '', dir: 'W' });
  const [dmsEndLat, setDmsEndLat] = useState({ d: '', m: '', s: '', dir: 'N' });
  const [dmsEndLng, setDmsEndLng] = useState({ d: '', m: '', s: '', dir: 'W' });
  
  const [files, setFiles] = useState<{ data: string; mimeType: string; name: string; id: string }[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('auto');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerationResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const mapRef1 = useRef<any>(null);
  const mapRef2 = useRef<any>(null);
  const mapRef3 = useRef<any>(null);
  const docId = useMemo(() => Math.floor(Math.random() * 900) + 100, [result]);
  const activeProviderLabel = providers.find((provider) => provider.id === selectedProvider)?.name || 'Auto (fallback)';

  useEffect(() => {
    const loadProviders = async () => {
      try {
        const response = await fetch('/api/providers');
        if (!response.ok) return;
        const data = await response.json();
        setProviders(Array.isArray(data.providers) ? data.providers : []);
      } catch (err) {
        console.error('Providers load error:', err);
      }
    };

    loadProviders();
  }, []);

  const parseDms = (input: string): string | null => {
    if (!input) return null;
    
    // Remove everything except digits, dots, commas and direction markers
    const clean = input.replace(/[^0-9.,NSEWnsew]/g, ' ').trim();
    // Normalize decimal separator
    const normalized = clean.replace(/,/g, '.');
    
    // Extract numbers
    const numbers = normalized.match(/\d+(?:\.\d+)?/g);
    if (!numbers || numbers.length === 0) return null;

    // Extract direction
    const dirMatch = normalized.match(/[NSEWnsew]/i);
    const dir = dirMatch ? dirMatch[0].toUpperCase() : 'N';

    const d = parseFloat(numbers[0]) || 0;
    const m = numbers.length > 1 ? parseFloat(numbers[1]) : 0;
    const s = numbers.length > 2 ? parseFloat(numbers[2]) : 0;

    let decimal = d + (m / 60) + (s / 3600);
    if (dir === 'S' || dir === 'W') decimal = decimal * -1;
    
    return decimal.toFixed(8);
  };

  const convertDmsToDecimal = (d: string, m: string, s: string, dir: string) => {
    const deg = parseFloat(d.replace(/,/g, '.')) || 0;
    const min = parseFloat(m.replace(/,/g, '.')) || 0;
    const sec = parseFloat(s.replace(/,/g, '.')) || 0;
    let decimal = deg + (min / 60) + (sec / 3600);
    if (dir === 'S' || dir === 'W') decimal = decimal * -1;
    return decimal.toFixed(8);
  };

  const handleApplyDMS = () => {
    let sLat = '', sLng = '', eLat = '', eLng = '';
    console.log("DMS Input Start:", dmsStartFull);
    console.log("DMS Input End:", dmsEndFull);

    if (dmsStartFull) {
      // Split by direction markers (N, S, E, W)
      const parts = dmsStartFull.match(/.*?[NSEWnsew]/gi);
      if (parts && parts.length >= 2) {
        sLat = parseDms(parts[0]) || '';
        sLng = parseDms(parts[1]) || '';
      } else if (parts && parts.length === 1) {
        sLat = parseDms(parts[0]) || '';
      } else {
        sLat = parseDms(dmsStartFull) || '';
      }
    } else {
      sLat = convertDmsToDecimal(dmsStartLat.d, dmsStartLat.m, dmsStartLat.s, dmsStartLat.dir);
      sLng = convertDmsToDecimal(dmsStartLng.d, dmsStartLng.m, dmsStartLng.s, dmsStartLng.dir);
    }

    if (dmsEndFull) {
      const parts = dmsEndFull.match(/.*?[NSEWnsew]/gi);
      if (parts && parts.length >= 2) {
        eLat = parseDms(parts[0]) || '';
        eLng = parseDms(parts[1]) || '';
      } else if (parts && parts.length === 1) {
        eLat = parseDms(parts[0]) || '';
      } else {
        eLat = parseDms(dmsEndFull) || '';
      }
    } else {
      eLat = convertDmsToDecimal(dmsEndLat.d, dmsEndLat.m, dmsEndLat.s, dmsEndLat.dir);
      eLng = convertDmsToDecimal(dmsEndLng.d, dmsEndLng.m, dmsEndLng.s, dmsEndLng.dir);
    }

    console.log("Converted Start:", sLat, sLng);
    console.log("Converted End:", eLat, eLng);

    if (sLat) setStartLat(sLat);
    if (sLng) setStartLng(sLng);
    if (eLat) setEndLat(eLat);
    if (eLng) setEndLng(eLng);

    // Dynamic update if report already exists so the map updates instantly
    if (result && (sLat || sLng || eLat || eLng)) {
      setResult({
        ...result,
        startCoords: { 
          lat: parseFloat(sLat || startLat || result.startCoords?.lat.toString() || '0'), 
          lng: parseFloat(sLng || startLng || result.startCoords?.lng.toString() || '0') 
        },
        endCoords: { 
          lat: parseFloat(eLat || endLat || result.endCoords?.lat.toString() || '0'), 
          lng: parseFloat(eLng || endLng || result.endCoords?.lng.toString() || '0') 
        }
      });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles) {
      Array.from(selectedFiles).forEach(processFile);
    }
  };

  const processFile = (selectedFile: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = (event.target?.result as string).split(',')[1];
      setFiles(prev => [...prev, {
        id: Math.random().toString(36).substring(7),
        data: base64,
        mimeType: selectedFile.type,
        name: selectedFile.name
      }]);
    };
    reader.readAsDataURL(selectedFile);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles) {
      Array.from(droppedFiles).forEach(processFile);
    }
  };

  const handleGenerate = async () => {
    if (!description.trim() && files.length === 0) return;
    
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          description: description || "Analiza los archivos adjuntos para generar el informe de localización.", 
          files,
          provider: selectedProvider,
          projectName,
          startCoords: startLat && startLng ? { lat: parseFloat(startLat), lng: parseFloat(startLng) } : null,
          endCoords: endLat && endLng ? { lat: parseFloat(endLat), lng: parseFloat(endLng) } : null,
        }),
      });
      
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Error al generar el informe');
      }
      
      const data = await response.json();
      setResult(sanitizeResult(data));

      // Audio warning: if audio files uploaded but provider is not Gemini
      const audioFiles = files.filter(f => f.mimeType.startsWith('audio/'));
      if (audioFiles.length > 0 && data._provider && !data._provider.includes('Gemini')) {
        setError(`⚠️ Nota: Se usó ${data._provider} (sin soporte de audio). Los archivos de audio fueron ignorados. Para procesar audio, configura GEMINI_API_KEY en .env.`);
      }
    } catch (err: any) {
      const msg: string = err.message || '';
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
        setError('⚠️ Cuota de la API agotada. Opciones: (1) Espera a mañana para que se reinicie el límite gratuito, (2) Usa una API Key nueva desde aistudio.google.com, (3) Activa facturación en console.cloud.google.com.');
      } else {
        setError(msg || 'Error al generar el informe');
      }
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };


  const downloadPDF = async () => {
    if (!result) return;
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pW = pdf.internal.pageSize.getWidth();   // 210
      const pH = pdf.internal.pageSize.getHeight();  // 297
      const ml = 20; const mr = 20;
      const cW = pW - ml - mr;
      let y = ml;

      // ── helpers ──────────────────────────────────────────────────────────
      const rgb = (r: number, g: number, b: number) =>
        pdf.setTextColor(r, g, b);
      const setDraw = (r: number, g: number, b: number) =>
        pdf.setDrawColor(r, g, b);
      const hline = (yy: number, r = 226, g = 232, b = 240) => {
        setDraw(r, g, b); pdf.setLineWidth(0.3);
        pdf.line(ml, yy, pW - mr, yy);
      };
      const newPageIfNeeded = (need: number) => {
        if (y + need > pH - 18) { pdf.addPage(); y = ml; }
      };
      const addPara = (text: string, size: number, bold = false,
                       indent = 0, lineGap = 1.4,
                       r = 71, g = 85, b = 105) => {
        pdf.setFontSize(size);
        pdf.setFont('helvetica', bold ? 'bold' : 'normal');
        rgb(r, g, b);
        const lines = pdf.splitTextToSize(text, cW - indent);
        lines.forEach((ln: string) => {
          newPageIfNeeded(size * 0.35 + lineGap);
          pdf.text(ln, ml + indent, y);
          y += size * 0.35 + lineGap;
        });
      };

      // ── page header (every page via event) ───────────────────────────────
      const drawHeader = () => {
        rgb(15, 23, 42);
        pdf.setFontSize(7); pdf.setFont('helvetica', 'bold');
        pdf.text('GEOREP ORT PRO IA', ml, 10);
        pdf.setFont('helvetica', 'normal');
        rgb(148, 163, 184);
        pdf.text(`GEO-${docId}-REPORT-PRO`, pW - mr, 10, { align: 'right' });
        hline(13, 203, 213, 225);
      };
      drawHeader();

      // ── title block ───────────────────────────────────────────────────────
      y = 22;
      rgb(15, 23, 42);
      pdf.setFontSize(16); pdf.setFont('helvetica', 'bold');
      pdf.text('CAPÍTULO: LOCALIZACIÓN DEL SITIO', ml, y); y += 7;
      rgb(100, 116, 139);
      pdf.setFontSize(8); pdf.setFont('helvetica', 'normal');
      pdf.text('REPORTE TÉCNICO DE INFRAESTRUCTURA VIAL', ml, y); y += 5;
      hline(y, 15, 23, 42); y += 5;

      // ── metadata grid ─────────────────────────────────────────────────────
      const meta: [string, string][] = [];
      if (result.projectName) meta.push(['Proyecto', result.projectName]);
      if (result.vereda)      meta.push(['Vereda', result.vereda]);
      if (result.convenioNumber) meta.push(['N° Convenio', result.convenioNumber]);
      if (meta.length > 0) {
        const colW = cW / 2;
        meta.forEach(([label, val], i) => {
          const cx = ml + (i % 2) * colW;
          if (i % 2 === 0 && i > 0) y += 8;
          rgb(148, 163, 184); pdf.setFontSize(7); pdf.setFont('helvetica', 'bold');
          pdf.text(label.toUpperCase(), cx, y);
          rgb(15, 23, 42); pdf.setFontSize(9); pdf.setFont('helvetica', 'bold');
          pdf.text(val, cx, y + 4);
        });
        y += 12;
      }
      hline(y); y += 8;

      // ── report body (markdown → jsPDF) ────────────────────────────────────
      const lines = (result.report || '').split('\n');
      for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line.trim()) { y += 2; continue; }

        if (/^#{1,2}\s/.test(line)) {
          const text = line.replace(/^#{1,2}\s+/, '').toUpperCase();
          newPageIfNeeded(12);
          y += 3;
          setDraw(37, 99, 235); pdf.setLineWidth(1.5);
          pdf.line(ml, y - 3.5, ml, y + 1);
          addPara(text, 9, true, 4, 1.2, 15, 23, 42);
          y += 2;
        } else if (/^#{3,6}\s/.test(line)) {
          const text = line.replace(/^#{3,6}\s+/, '');
          newPageIfNeeded(8);
          addPara(text, 9, true, 0, 1.2, 37, 99, 235);
        } else if (/^\s*[-*+]\s/.test(line)) {
          const text = line.replace(/^\s*[-*+]\s+/, '');
          const clean = text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '');
          addPara('• ' + clean, 9, false, 4, 1.3, 71, 85, 105);
        } else if (/^\s*\d+\.\s/.test(line)) {
          const clean = line.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '');
          addPara(clean, 9, false, 4, 1.3, 71, 85, 105);
        } else {
          const clean = line.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '');
          addPara(clean, 10, false, 0, 1.5, 71, 85, 105);
        }
      }

      // ── coordinates & map section ─────────────────────────────────────────
      if (hasValidCoords(result.startCoords) && hasValidCoords(result.endCoords)) {
        newPageIfNeeded(120);
        y += 6; hline(y); y += 8;

        const mapEls = Array.from(reportRef.current?.querySelectorAll<HTMLElement>('.leaflet-container') || []);
        
        for (let mapIdx = 0; mapIdx < mapEls.length; mapIdx++) {
          const mapEl = mapEls[mapIdx];
          
          if (mapIdx > 0) {
            newPageIfNeeded(120);
          }
          
          let mapTitle = 'ANEXO A: GEORREFERENCIACIÓN Y TRAZADO VIAL PRINCIPAL';
          if (mapIdx === 1) {
            mapTitle = 'ANEXO B: TRAZADO VIAL CON MARCAS ADICIONALES (GRUPO A)';
          } else if (mapIdx === 2) {
            mapTitle = 'ANEXO C: TRAZADO VIAL CON MARCAS ADICIONALES (GRUPO B)';
          }
          
          addPara(mapTitle, 9, true, 0, 1.2, 15, 23, 42);
          y += 3;
          
          if (mapIdx === 0) {
            const coordRow = (label: string, lat: number, lng: number, rx: number) => {
              pdf.setFillColor(248, 250, 252);
              pdf.roundedRect(rx, y, cW / 2 - 3, 13, 2, 2, 'F');
              rgb(148, 163, 184); pdf.setFontSize(7); pdf.setFont('helvetica', 'bold');
              pdf.text(label, rx + 4, y + 4);
              rgb(30, 41, 59); pdf.setFontSize(8); pdf.setFont('helvetica', 'normal');
              pdf.text(`${lat.toFixed(8)}`, rx + 4, y + 9);
              pdf.text(`${lng.toFixed(8)}`, rx + 4 + (cW / 2 - 3) / 2, y + 9);
            };
            coordRow('INICIO', result.startCoords.lat, result.startCoords.lng, ml);
            coordRow('FINAL', result.endCoords.lat, result.endCoords.lng, ml + cW / 2 + 1);
            y += 18;
          } else if (mapIdx === 1) {
            const validGroupAMarkers = image2Markers.filter(m => {
              const lat = parseFloat(m.lat);
              const lng = parseFloat(m.lng);
              return !isNaN(lat) && !isNaN(lng);
            });
            
            if (validGroupAMarkers.length > 0) {
              pdf.setFillColor(248, 250, 252);
              pdf.roundedRect(ml, y, cW, 6 + validGroupAMarkers.length * 6, 2, 2, 'F');
              
              rgb(148, 163, 184); pdf.setFontSize(7); pdf.setFont('helvetica', 'bold');
              pdf.text('ETIQUETA', ml + 4, y + 4);
              pdf.text('LATITUD', ml + cW / 3 + 4, y + 4);
              pdf.text('LONGITUD', ml + (2 * cW) / 3 + 4, y + 4);
              
              rgb(30, 41, 59); pdf.setFontSize(8); pdf.setFont('helvetica', 'normal');
              validGroupAMarkers.forEach((m, idx) => {
                const yy = y + 9 + idx * 6;
                pdf.text(m.label || `Marca ${idx + 1}`, ml + 4, yy);
                pdf.text(parseFloat(m.lat).toFixed(8), ml + cW / 3 + 4, yy);
                pdf.text(parseFloat(m.lng).toFixed(8), ml + (2 * cW) / 3 + 4, yy);
              });
              y += 10 + validGroupAMarkers.length * 6;
            }
          } else if (mapIdx === 2) {
            const validGroupBMarkers = image3Markers.filter(m => {
              const lat = parseFloat(m.lat);
              const lng = parseFloat(m.lng);
              return !isNaN(lat) && !isNaN(lng);
            });
            
            if (validGroupBMarkers.length > 0) {
              pdf.setFillColor(248, 250, 252);
              pdf.roundedRect(ml, y, cW, 6 + validGroupBMarkers.length * 6, 2, 2, 'F');
              
              rgb(148, 163, 184); pdf.setFontSize(7); pdf.setFont('helvetica', 'bold');
              pdf.text('ETIQUETA', ml + 4, y + 4);
              pdf.text('LATITUD', ml + cW / 3 + 4, y + 4);
              pdf.text('LONGITUD', ml + (2 * cW) / 3 + 4, y + 4);
              
              rgb(30, 41, 59); pdf.setFontSize(8); pdf.setFont('helvetica', 'normal');
              validGroupBMarkers.forEach((m, idx) => {
                const yy = y + 9 + idx * 6;
                pdf.text(m.label || `Marca ${idx + 1}`, ml + 4, yy);
                pdf.text(parseFloat(m.lat).toFixed(8), ml + cW / 3 + 4, yy);
                pdf.text(parseFloat(m.lng).toFixed(8), ml + (2 * cW) / 3 + 4, yy);
              });
              y += 10 + validGroupBMarkers.length * 6;
            }
          }

          // ── Capture Leaflet map as rendered on screen ──
          const mapRect = mapEl.getBoundingClientRect();
          let renderedCanvas: HTMLCanvasElement | null = null;
          let usedManualRenderer = false;
          const drawGridLabelsFromDom = (targetCtx: CanvasRenderingContext2D) => {
            const labels = Array.from(mapEl.querySelectorAll<HTMLElement>('.lat-label-text, .lng-label-text'));
            const scaleX = targetCtx.canvas.width / mapRect.width;
            const scaleY = targetCtx.canvas.height / mapRect.height;
            const fontSize = 16 * Math.max(scaleX, scaleY);

            targetCtx.save();
            targetCtx.font = `bold ${fontSize}px monospace`;
            targetCtx.textBaseline = 'middle';

            for (const label of labels) {
              const rect = label.getBoundingClientRect();
              if (!rect.width || !rect.height) continue;

              const text = label.textContent?.trim();
              if (!text) continue;

              const style = window.getComputedStyle(label);
              const x = (rect.left - mapRect.left) * scaleX;
              const yy = (rect.top - mapRect.top + rect.height / 2) * scaleY;
              const isLng = label.classList.contains('lng-label-text');

              targetCtx.save();
              targetCtx.fillStyle = style.color || (useSatellite ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.7)');
              targetCtx.shadowColor = style.textShadow && style.textShadow !== 'none'
                ? (useSatellite ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.9)')
                : 'transparent';
              targetCtx.shadowBlur = style.textShadow && style.textShadow !== 'none' ? 2 * Math.max(scaleX, scaleY) : 0;
              if (isLng) {
                targetCtx.translate(x, yy);
                targetCtx.rotate(-Math.PI / 2);
                targetCtx.textAlign = 'left';
                targetCtx.fillText(text, 0, 0);
              } else {
                targetCtx.textAlign = 'left';
                targetCtx.fillText(text, x, yy);
              }
              targetCtx.restore();
            }

            targetCtx.restore();
          };

          try {
            renderedCanvas = await html2canvas(mapEl, {
              useCORS: true,
              allowTaint: false,
              backgroundColor: '#f8fafc',
              scale: 2,
              logging: false,
              ignoreElements: (element) => {
                const classList = (element as HTMLElement).classList;
                return !!classList && (
                  classList.contains('leaflet-control-container') ||
                  classList.contains('leaflet-popup-pane')
                );
              },
            });
          } catch (captureErr) {
            console.warn('html2canvas map capture failed, falling back to manual renderer:', captureErr);
          }

          if (!renderedCanvas) {
            const canvas = document.createElement('canvas');
            canvas.width = mapRect.width;
            canvas.height = mapRect.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.fillStyle = '#f8fafc';
              ctx.fillRect(0, 0, canvas.width, canvas.height);

              // 1. Load and draw all tile images via clean Image objects with crossOrigin
              const tiles = Array.from(mapEl.querySelectorAll<HTMLImageElement>('img'));
              const tilePromises = tiles.map(async (img) => {
                if (!img.src || img.style.display === 'none' || img.src.includes('marker')) return;
                const rect = img.getBoundingClientRect();
                const x = rect.left - mapRect.left;
                const ty = rect.top - mapRect.top;
                await new Promise<void>((resolve) => {
                  const newImg = new Image();
                  newImg.crossOrigin = 'anonymous';
                  newImg.onload = () => {
                    ctx.drawImage(newImg, x, ty, rect.width, rect.height);
                    resolve();
                  };
                  newImg.onerror = () => resolve();
                  newImg.src = img.src;
                });
              });
              await Promise.all(tilePromises);

              // 2. Draw SVG overlays
              const svgs = Array.from(mapEl.querySelectorAll<SVGElement>('svg'));
              for (const svg of svgs) {
                const svgRect = svg.getBoundingClientRect();
                const svgX = svgRect.left - mapRect.left;
                const svgY = svgRect.top - mapRect.top;

                await new Promise<void>((resolve) => {
                  const clonedSvg = svg.cloneNode(true) as SVGElement;
                  clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                  clonedSvg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
                  clonedSvg.setAttribute('width', `${svgRect.width}`);
                  clonedSvg.setAttribute('height', `${svgRect.height}`);

                  if (!clonedSvg.getAttribute('viewBox')) {
                    clonedSvg.setAttribute('viewBox', `0 0 ${svgRect.width} ${svgRect.height}`);
                  }

                  const svgMarkup = new XMLSerializer().serializeToString(clonedSvg);
                  const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
                  const svgUrl = URL.createObjectURL(svgBlob);
                  const svgImg = new Image();

                  svgImg.onload = () => {
                    ctx.drawImage(svgImg, svgX, svgY, svgRect.width, svgRect.height);
                    URL.revokeObjectURL(svgUrl);
                    resolve();
                  };

                  svgImg.onerror = () => {
                    URL.revokeObjectURL(svgUrl);
                    resolve();
                  };

                  svgImg.src = svgUrl;
                });
              }

              // 3. Draw Marker Circles & Tooltips via DOM
              const markerElements = Array.from(mapEl.querySelectorAll<HTMLElement>('.leaflet-marker-icon:not(.grid-label)'));
              markerElements.forEach((m, markerIdx) => {
                const mRect = m.getBoundingClientRect();
                const mx = mRect.left - mapRect.left;
                const my = mRect.top - mapRect.top;
                
                let markerColor = '#059669';
                if (markerIdx === 0) {
                  markerColor = '#1e293b';
                } else if (markerIdx === 1) {
                  markerColor = '#2563eb';
                }

                ctx.fillStyle = markerColor;
                ctx.beginPath();
                ctx.arc(mx + (mRect.width || 25) / 2, my + (mRect.height || 41) / 2, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
              });

              const tooltips = Array.from(mapEl.querySelectorAll<HTMLElement>('.leaflet-tooltip'));
              tooltips.forEach((t) => {
                const tRect = t.getBoundingClientRect();
                const tx = tRect.left - mapRect.left;
                const ty = tRect.top - mapRect.top;
                
                const text = t.textContent?.trim() || '';
                let tooltipBg = '#059669';
                if (text.includes('INICIO')) {
                  tooltipBg = '#1e293b';
                } else if (text.includes('FINAL')) {
                  tooltipBg = '#2563eb';
                }

                ctx.fillStyle = tooltipBg;
                ctx.fillRect(tx, ty, tRect.width || 45, tRect.height || 22);
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 10px sans-serif';
                ctx.fillText(text, tx + 6, ty + 14);
              });

              renderedCanvas = canvas;
              usedManualRenderer = true;
            }
          }

          if (renderedCanvas) {
            try {
              const renderedCtx = renderedCanvas.getContext('2d');
              if (renderedCtx && usedManualRenderer) {
                drawGridLabelsFromDom(renderedCtx);
              }

              const mapDataUrl = renderedCanvas.toDataURL('image/jpeg', 0.92);
              const mapH = (cW * mapRect.height) / mapRect.width;
              newPageIfNeeded(mapH + 10);
              pdf.addImage(mapDataUrl, 'JPEG', ml, y, cW, mapH);
              y += mapH + 10;
            } catch (e) {
              console.error("Canvas toDataURL tainted error:", e);
            }
          }
        }
      }

      // ── footer on every page ──────────────────────────────────────────────
      const totalPages = (pdf as any).internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        hline(pH - 14, 226, 232, 240);
        rgb(148, 163, 184); pdf.setFontSize(7); pdf.setFont('helvetica', 'normal');
        pdf.text(`GEO-${docId}-REPORT-PRO  |  ${new Date().toLocaleDateString('es-CO')}`, ml, pH - 9);
        pdf.text(`Página ${i} de ${totalPages}`, pW - mr, pH - 9, { align: 'right' });
      }

      // ── download ──────────────────────────────────────────────────────────
      const fname = `${result.projectName || projectName || 'Reporte-Localizacion'}.pdf`;
      pdf.save(fname);

    } catch (err: any) {
      console.error('PDF Error:', err);
      setError(`Error al generar PDF: ${err?.message || String(err)}`);
    }
  };


  return (
    <div className="flex min-h-screen w-full bg-slate-50 text-slate-900 font-sans">
      {/* Sidebar */}
      <aside className="hidden lg:flex w-72 bg-slate-900 text-white flex-col shrink-0 sticky top-0 h-screen">
        <div className="p-6 border-b border-slate-700">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 bg-blue-500 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Navigation className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">GeoReport <span className="text-blue-400">Pro</span></h1>
          </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <div className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">Configuración de Informe</div>
          
          <button className="w-full flex items-center justify-between bg-slate-800 p-3 rounded-xl text-sm font-medium border-l-4 border-blue-500 transition-all text-left">
            <span className="flex items-center gap-3">
              <Layout className="w-4 h-4 text-blue-400" />
              Nueva Localización
            </span>
            <ChevronRight className="w-3 h-3 text-slate-500" />
          </button>
          
          <button className="w-full flex items-center justify-between p-3 rounded-xl text-sm font-medium hover:bg-slate-800 transition-all text-left text-slate-400 group">
            <span className="flex items-center gap-3 group-hover:text-slate-200">
              <History className="w-4 h-4" />
              Historial de Rutas
            </span>
          </button>
          
          <button className="w-full flex items-center justify-between p-3 rounded-xl text-sm font-medium hover:bg-slate-800 transition-all text-left text-slate-400 group">
            <span className="flex items-center gap-3 group-hover:text-slate-200">
              <FileCode className="w-4 h-4" />
              Plantillas Técnicas
            </span>
          </button>

          <div className="pt-6 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">Exportación</div>
          
          <button className="w-full flex items-center justify-between p-3 rounded-xl text-sm font-medium hover:bg-slate-800 transition-all text-left text-slate-400 group">
            <span className="flex items-center gap-3 group-hover:text-slate-200">
              <FileText className="w-4 h-4" />
              PDF Auto-Generator
            </span>
          </button>
        </nav>

        <div className="p-6 bg-slate-950/50">
            <div className="flex items-center space-x-3 text-[10px] uppercase tracking-widest opacity-60">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse ring-4 ring-green-400/20"></div>
            <span>Motor {activeProviderLabel} Activo</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col">
        {/* Top Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 sticky top-0 z-30">
          <div className="flex items-center space-x-4">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Asistente:</span>
            <span className="px-3 py-1 bg-blue-50 text-blue-700 text-[10px] font-bold rounded-full uppercase tracking-wide border border-blue-100">
              Especialista Documentación
            </span>
          </div>
          <div className="flex items-center space-x-3">
            <button className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
              <Share2 className="w-4 h-4" />
            </button>
            <div className="h-4 w-px bg-slate-200 mx-2"></div>
            <button 
              onClick={handleGenerate}
              disabled={loading || (!description.trim() && files.length === 0)}
              className="px-5 py-2 text-xs font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-lg shadow-blue-600/20 disabled:opacity-50 disabled:shadow-none flex items-center gap-2 transition-all active:scale-95"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              EJECUTAR GENERADOR
            </button>
          </div>
        </header>

        {/* Editor Grid */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-px bg-slate-200">
          
          {/* Left Pane: Input and Analysis */}
          <section className="bg-white flex flex-col p-8">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-1.5 bg-slate-100 rounded-md">
                  <Terminal className="w-4 h-4 text-slate-600" />
                </div>
                <h2 className="text-xs font-bold text-slate-800 uppercase tracking-widest text-balance">Análisis de Ruta Informal</h2>
              </div>
              <span className="text-[10px] text-slate-400 font-medium italic">Entrada de Audio/Texto</span>
            </div>
            
            <div className="flex-1 flex flex-col space-y-6 overflow-hidden">
              <div 
                className="grid grid-cols-2 gap-4"
              >
                <div className="col-span-2">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Nombre del Proyecto / Tramo</label>
                    <button 
                      onClick={() => setUseDMS(!useDMS)}
                      className="text-[9px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-bold hover:bg-slate-200 transition-colors"
                    >
                      {useDMS ? 'USAR DECIMALES' : 'USAR G/M/S'}
                    </button>
                  </div>
                  <input
                    type="text"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500/50 transition-all"
                    placeholder="Ej: Intervención Vereda El Salado"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                  />
                </div>

                {useDMS ? (
                  <>
                    <div className="col-span-2 space-y-4">
                      {/* DMS Start */}
                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                        <div className="flex items-center justify-between mb-3">
                          <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Punto de Inicio (DMS)</label>
                          {startLat && startLng && (
                            <span className="text-[8px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-mono">
                              {parseFloat(startLat).toFixed(4)}, {parseFloat(startLng).toFixed(4)}
                            </span>
                          )}
                        </div>
                        <input 
                          className="w-full p-2 bg-white border border-slate-200 rounded text-xs mb-4 font-mono focus:border-blue-500 outline-none transition-all" 
                          placeholder="Pega aquí: 8°26'49.6&quot;N 74°41'46.2&quot;W"
                          value={dmsStartFull}
                          onChange={e => setDmsStartFull(e.target.value)}
                        />
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <p className="text-[8px] font-bold text-slate-400 uppercase">Latitud</p>
                            <div className="flex gap-1 items-center">
                              <input placeholder="G" className="w-full p-2 bg-white border rounded text-xs" value={dmsStartLat.d} onChange={e => setDmsStartLat({...dmsStartLat, d: e.target.value})} />
                              <input placeholder="M" className="w-full p-2 bg-white border rounded text-xs" value={dmsStartLat.m} onChange={e => setDmsStartLat({...dmsStartLat, m: e.target.value})} />
                              <input placeholder="S" className="w-full p-2 bg-white border rounded text-xs" value={dmsStartLat.s} onChange={e => setDmsStartLat({...dmsStartLat, s: e.target.value})} />
                              <select className="p-2 bg-white border rounded text-xs" value={dmsStartLat.dir} onChange={e => setDmsStartLat({...dmsStartLat, dir: e.target.value})}>
                                <option>N</option><option>S</option>
                              </select>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <p className="text-[8px] font-bold text-slate-400 uppercase">Longitud</p>
                            <div className="flex gap-1 items-center">
                              <input placeholder="G" className="w-full p-2 bg-white border rounded text-xs" value={dmsStartLng.d} onChange={e => setDmsStartLng({...dmsStartLng, d: e.target.value})} />
                              <input placeholder="M" className="w-full p-2 bg-white border rounded text-xs" value={dmsStartLng.m} onChange={e => setDmsStartLng({...dmsStartLng, m: e.target.value})} />
                              <input placeholder="S" className="w-full p-2 bg-white border rounded text-xs" value={dmsStartLng.s} onChange={e => setDmsStartLng({...dmsStartLng, s: e.target.value})} />
                              <select className="p-2 bg-white border rounded text-xs" value={dmsStartLng.dir} onChange={e => setDmsStartLng({...dmsStartLng, dir: e.target.value})}>
                                <option>E</option><option>W</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* DMS End */}
                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                        <div className="flex items-center justify-between mb-3">
                          <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Punto de Fin (DMS)</label>
                          {endLat && endLng && (
                            <span className="text-[8px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-mono">
                              {parseFloat(endLat).toFixed(4)}, {parseFloat(endLng).toFixed(4)}
                            </span>
                          )}
                        </div>
                        <input 
                          className="w-full p-2 bg-white border border-slate-200 rounded text-xs mb-4 font-mono focus:border-blue-500 outline-none transition-all" 
                          placeholder="Pega aquí: 8°26'49.6&quot;N 74°41'46.2&quot;W"
                          value={dmsEndFull}
                          onChange={e => setDmsEndFull(e.target.value)}
                        />
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <p className="text-[8px] font-bold text-slate-400 uppercase">Latitud</p>
                            <div className="flex gap-1 items-center">
                              <input placeholder="G" className="w-full p-2 bg-white border rounded text-xs" value={dmsEndLat.d} onChange={e => setDmsEndLat({...dmsEndLat, d: e.target.value})} />
                              <input placeholder="M" className="w-full p-2 bg-white border rounded text-xs" value={dmsEndLat.m} onChange={e => setDmsEndLat({...dmsEndLat, m: e.target.value})} />
                              <input placeholder="S" className="w-full p-2 bg-white border rounded text-xs" value={dmsEndLat.s} onChange={e => setDmsEndLat({...dmsEndLat, s: e.target.value})} />
                              <select className="p-2 bg-white border rounded text-xs" value={dmsEndLat.dir} onChange={e => setDmsEndLat({...dmsEndLat, dir: e.target.value})}>
                                <option>N</option><option>S</option>
                              </select>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <p className="text-[8px] font-bold text-slate-400 uppercase">Longitud</p>
                            <div className="flex gap-1 items-center">
                              <input placeholder="G" className="w-full p-2 bg-white border rounded text-xs" value={dmsEndLng.d} onChange={e => setDmsEndLng({...dmsEndLng, d: e.target.value})} />
                              <input placeholder="M" className="w-full p-2 bg-white border rounded text-xs" value={dmsEndLng.m} onChange={e => setDmsEndLng({...dmsEndLng, m: e.target.value})} />
                              <input placeholder="S" className="w-full p-2 bg-white border rounded text-xs" value={dmsEndLng.s} onChange={e => setDmsEndLng({...dmsEndLng, s: e.target.value})} />
                              <select className="p-2 bg-white border rounded text-xs" value={dmsEndLng.dir} onChange={e => setDmsEndLng({...dmsEndLng, dir: e.target.value})}>
                                <option>E</option><option>W</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>

                      <button 
                        onClick={handleApplyDMS}
                        className="w-full py-2 bg-slate-800 text-white text-[10px] uppercase font-bold rounded-lg hover:bg-slate-900 transition-all flex items-center justify-center gap-2"
                      >
                        <MapPin className="w-3 h-3" />
                        Convertir y Aplicar Coordenadas
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">Coordenadas Inicio (Lat, Lng)</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500/50 transition-all font-mono"
                          placeholder="Lat"
                          value={startLat}
                          onChange={(e) => setStartLat(e.target.value)}
                        />
                        <input
                          type="text"
                          className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500/50 transition-all font-mono"
                          placeholder="Lng"
                          value={startLng}
                          onChange={(e) => setStartLng(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">Coordenadas Fin (Lat, Lng)</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500/50 transition-all font-mono"
                          placeholder="Lat"
                          value={endLat}
                          onChange={(e) => setEndLat(e.target.value)}
                        />
                        <input
                          type="text"
                          className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500/50 transition-all font-mono"
                          placeholder="Lng"
                          value={endLng}
                          onChange={(e) => setEndLng(e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Panel de marcas adicionales premium */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 transition-all duration-300 hover:shadow-md shrink-0">
                <button
                  type="button"
                  onClick={() => setShowAdditionalMarkers(!showAdditionalMarkers)}
                  className="w-full flex items-center justify-between text-xs font-bold text-slate-800 uppercase tracking-widest outline-none text-left"
                >
                  <span className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-blue-500" />
                    Marcas de Posición (Anexos B y C)
                  </span>
                  <span className={`transform transition-transform duration-300 font-bold ${showAdditionalMarkers ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                </button>

                {showAdditionalMarkers && (
                  <div className="mt-4 pt-4 border-t border-slate-200/60 space-y-4">
                    {/* Selector de Grupo */}
                    <div className="flex gap-2 p-1 bg-slate-200/60 rounded-xl">
                      <button
                        type="button"
                        onClick={() => setActiveMarkerTab('A')}
                        className={`flex-1 py-1.5 text-[9px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                          activeMarkerTab === 'A'
                            ? 'bg-white text-blue-600 shadow-sm'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        Mapa Anexo B
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveMarkerTab('B')}
                        className={`flex-1 py-1.5 text-[9px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                          activeMarkerTab === 'B'
                            ? 'bg-white text-blue-600 shadow-sm'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        Mapa Anexo C
                      </button>
                    </div>

                    {/* Grupo A */}
                    {activeMarkerTab === 'A' ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Marcas Adicionales - Grupo A</span>
                          <button
                            type="button"
                            onClick={addMarker2}
                            className="text-[8px] bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 px-2 py-0.5 rounded font-bold transition-all uppercase"
                          >
                            + Agregar Marca
                          </button>
                        </div>

                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                          {image2Markers.map((marker, index) => (
                            <div key={marker.id} className="grid grid-cols-[1fr_1fr_1.2fr_auto] gap-1 items-center bg-white p-2 rounded-xl border border-slate-150 shadow-sm">
                              <input
                                type="text"
                                placeholder="Lat"
                                value={marker.lat}
                                onChange={(e) => updateMarker2(marker.id, 'lat', e.target.value)}
                                className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-mono focus:border-blue-500 outline-none w-full"
                              />
                              <input
                                type="text"
                                placeholder="Lng"
                                value={marker.lng}
                                onChange={(e) => updateMarker2(marker.id, 'lng', e.target.value)}
                                className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-mono focus:border-blue-500 outline-none w-full"
                              />
                              <input
                                type="text"
                                placeholder="Etiqueta"
                                value={marker.label}
                                onChange={(e) => updateMarker2(marker.id, 'label', e.target.value)}
                                className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-medium focus:border-blue-500 outline-none w-full"
                              />
                              <button
                                type="button"
                                onClick={() => removeMarker2(marker.id)}
                                className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                        {image2Markers.length === 0 && (
                          <p className="text-[9px] text-slate-400 italic text-center py-1">No hay marcas añadidas en el Grupo A.</p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Marcas Adicionales - Grupo B</span>
                          <button
                            type="button"
                            onClick={addMarker3}
                            className="text-[8px] bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 px-2 py-0.5 rounded font-bold transition-all uppercase"
                          >
                            + Agregar Marca
                          </button>
                        </div>

                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                          {image3Markers.map((marker, index) => (
                            <div key={marker.id} className="grid grid-cols-[1fr_1fr_1.2fr_auto] gap-1 items-center bg-white p-2 rounded-xl border border-slate-150 shadow-sm">
                              <input
                                type="text"
                                placeholder="Lat"
                                value={marker.lat}
                                onChange={(e) => updateMarker3(marker.id, 'lat', e.target.value)}
                                className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-mono focus:border-blue-500 outline-none w-full"
                              />
                              <input
                                type="text"
                                placeholder="Lng"
                                value={marker.lng}
                                onChange={(e) => updateMarker3(marker.id, 'lng', e.target.value)}
                                className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-mono focus:border-blue-500 outline-none w-full"
                              />
                              <input
                                type="text"
                                placeholder="Etiqueta"
                                value={marker.label}
                                onChange={(e) => updateMarker3(marker.id, 'label', e.target.value)}
                                className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-medium focus:border-blue-500 outline-none w-full"
                              />
                              <button
                                type="button"
                                onClick={() => removeMarker3(marker.id)}
                                className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                        {image3Markers.length === 0 && (
                          <p className="text-[9px] text-slate-400 italic text-center py-1">No hay marcas añadidas en el Grupo B.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div 
                className={`flex-1 flex flex-col space-y-4 ${isDragging ? 'opacity-50' : ''}`}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              >
                <textarea
                  id="description"
                  className="w-full h-40 p-6 bg-slate-50 border border-slate-200 rounded-2xl font-mono text-sm text-slate-600 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500/50 transition-all shrink-0"
                  placeholder="Escribe o pega la descripción informal de la ruta aquí..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />

                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_180px] gap-3">
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">Motor IA</label>
                    <select
                      className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500/50 transition-all"
                      value={selectedProvider}
                      onChange={(e) => setSelectedProvider(e.target.value)}
                    >
                      {(providers.length > 0 ? providers : [{ id: 'auto', name: 'Auto (fallback)', configured: true, supportsFiles: true }]).map((provider) => (
                        <option key={provider.id} value={provider.id} disabled={!provider.configured}>
                          {provider.name}{provider.configured ? '' : ' (no configurado)'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-[10px] text-slate-500 uppercase tracking-wider font-bold flex flex-col justify-center">
                    <span className="text-slate-400">Selección</span>
                    <span className="text-slate-800 mt-1">{activeProviderLabel}</span>
                  </div>
                </div>

                <div className="relative group cursor-pointer">
                  <input
                    type="file"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    onChange={handleFileChange}
                    accept="audio/*,.pdf,.txt,.doc,.docx"
                    multiple
                  />
                  <div className={`p-8 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center space-y-3 transition-all border-slate-200 bg-slate-50 group-hover:border-blue-500 min-h-[140px]`}>
                    <div className="p-3 bg-white rounded-xl shadow-sm border border-slate-100 group-hover:scale-110 transition-transform">
                      <FileCode className="w-6 h-6 text-slate-400 group-hover:text-blue-500" />
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-bold text-slate-600 uppercase tracking-widest">Arrastra documentos o audios</p>
                      <p className="text-[10px] text-slate-400 mt-1">PDF, Audio, Texto (Múltiples archivos)</p>
                    </div>
                  </div>
                </div>

                {files.length > 0 && (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                    {files.map((f) => (
                      <div key={f.id} className="flex items-center justify-between p-3 bg-green-50/50 border border-green-100 rounded-xl">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <Check className="w-4 h-4 text-green-600 shrink-0" />
                          <span className="text-xs font-bold text-green-800 truncate">{f.name}</span>
                        </div>
                        <button 
                          onClick={() => setFiles(prev => prev.filter(item => item.id !== f.id))}
                          className="text-[10px] text-red-500 font-bold uppercase tracking-widest hover:underline shrink-0"
                        >
                          Eliminar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-xl text-xs border border-red-100 font-medium">
                  {error}
                </div>
              )}

              {result && (
                <div 
                  style={{ animation: 'fadeIn 0.3s ease' }}
                  className="bg-slate-900 rounded-2xl p-6 shadow-xl border border-slate-800 relative overflow-hidden group"
                >
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2 text-white/90">
                      <FileCode className="w-4 h-4 text-blue-400" />
                      <h3 className="text-[10px] font-bold uppercase tracking-widest">Código Python Generado</h3>
                    </div>
                    <button
                      onClick={() => copyToClipboard(result.code)}
                      className="p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-800"
                    >
                      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  
                  <div className="bg-black/50 rounded-xl p-4 font-mono text-[11px] overflow-x-auto text-blue-100/80 leading-relaxed border border-white/5 h-48">
                    <pre><code>{result.code}</code></pre>
                  </div>
              </div>
              )}
            </div>
          </section>

          {/* Right Pane: Technical Report Output */}
          <section className="bg-slate-50 flex flex-col p-8">
            {/* Empty state */}
            {!result && !loading && (
              <div
                className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4"
                style={{ animation: 'fadeIn 0.3s ease' }}
              >
                <MapPin className="w-12 h-12 opacity-10" />
                <p className="text-xs font-bold uppercase tracking-widest">Esperando Parámetros de Ruta</p>
              </div>
            )}

            {/* Loading state */}
            {loading && (
              <div
                className="h-full flex flex-col items-center justify-center space-y-6"
                style={{ animation: 'fadeIn 0.3s ease' }}
              >
                <div className="relative">
                  <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin"></div>
                  <Navigation className="w-4 h-4 text-blue-500 absolute inset-0 m-auto animate-pulse" />
                </div>
                <div className="text-center">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-800">Generando Reporte</p>
                  <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider">Georreferenciando puntos de interés...</p>
                </div>
              </div>
            )}

            {/* Result state */}
            {result && !loading && (
              <div
                ref={reportRef}
                className="max-w-2xl mx-auto w-full bg-white shadow-2xl border border-slate-200 p-12 min-h-full flex flex-col relative"
                style={{ animation: 'fadeIn 0.4s ease' }}
              >
                  <button 
                    onClick={downloadPDF}
                    className="absolute top-4 right-4 p-2 bg-blue-600 text-white rounded-lg shadow-lg hover:bg-blue-700 transition-all flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider z-10"
                    title="Descargar Reporte en PDF"
                  >
                    <Download className="w-3 h-3" />
                    Bajar PDF
                  </button>

                  <div className="border-b-2 border-slate-900 pb-6 mb-8 flex justify-between items-start">
                    <div className="flex-1">
                      <h1 className="text-2xl font-serif font-bold text-slate-900 tracking-tight leading-tight">CAPÍTULO: LOCALIZACIÓN DEL SITIO</h1>
                      <p className="text-[10px] text-slate-500 uppercase tracking-[0.3em] font-bold mt-2 border-b border-slate-100 pb-2 mb-4">Reporte Técnico de Infraestructura Vial</p>
                      
                      <div className="grid grid-cols-2 gap-y-2 text-[10px] uppercase tracking-wider font-bold text-slate-400">
                        {result.projectName && (
                          <div className="flex flex-col">
                            <span className="text-[8px] opacity-70">Proyecto</span>
                            <span className="text-slate-800">{result.projectName}</span>
                          </div>
                        )}
                        {result.vereda && (
                          <div className="flex flex-col">
                            <span className="text-[8px] opacity-70">Vereda</span>
                            <span className="text-slate-800">{result.vereda}</span>
                          </div>
                        )}
                        {result.convenioNumber && (
                          <div className="flex flex-col">
                            <span className="text-[8px] opacity-70">N° Convenio</span>
                            <span className="text-slate-800">{result.convenioNumber}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="w-16 h-16 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-center grayscale opacity-50 shrink-0 ml-4">
                      <Navigation className="w-8 h-8 text-slate-900" />
                    </div>
                  </div>
                  
                  <div className="flex-1 prose prose-slate prose-sm max-w-none 
                    prose-headings:font-bold prose-headings:text-slate-900 prose-headings:uppercase prose-headings:text-xs prose-headings:tracking-widest prose-headings:border-l-4 prose-headings:border-blue-600 prose-headings:pl-3 prose-headings:mb-4
                    prose-p:text-slate-600 prose-p:leading-relaxed prose-p:mb-6
                    prose-li:text-slate-600
                  ">
                    <ReactMarkdown>{result.report}</ReactMarkdown>
                  </div>

                  {/* Map Visual Section */}
                  {hasValidCoords(result.startCoords) && hasValidCoords(result.endCoords) ? (
                    <div className="mt-8 pt-8 border-t border-slate-100 flex-1 flex flex-col space-y-12">
                      
                      {/* MAP 1: ANEXO A */}
                      <div className="flex flex-col min-h-[400px]">
                        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-[0.2em]">ANEXO A: GEORREFERENCIACIÓN Y TRAZADO VIAL PRINCIPAL</h3>
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5 bg-slate-100 rounded-lg p-1">
                              <MapIcon className="w-3 h-3 text-slate-500 ml-1" />
                              <select
                                value={baseLayer}
                                onChange={(e) => setBaseLayer(e.target.value)}
                                className="text-[10px] bg-transparent text-slate-700 font-bold uppercase cursor-pointer outline-none pr-1 py-0.5"
                                title="Cambiar capa base del mapa"
                              >
                                {BASE_LAYERS.map(l => (
                                  <option key={l.id} value={l.id}>{l.label}</option>
                                ))}
                              </select>
                            </div>
                            {result._provider && (
                              <span className="text-[9px] bg-green-50 text-green-600 px-2 py-1 rounded font-bold uppercase border border-green-100">
                                IA: {result._provider}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex-1 rounded-2xl overflow-hidden border border-slate-200 relative shadow-inner aspect-[4/3] w-full min-h-[400px]">
                          <MapContainer
                            ref={mapRef1}
                            key={`map1-${result.startCoords!.lat}-${result.startCoords!.lng}-${result.endCoords!.lat}-${result.endCoords!.lng}`}
                            center={[result.startCoords!.lat, result.startCoords!.lng]}
                            zoom={13}
                            style={{ height: '100%', width: '100%' }}
                            scrollWheelZoom={false}
                          >
                            <CoordinateGrid useSatellite={useSatellite} />
                            <ChangeView center={[result.startCoords!.lat, result.startCoords!.lng]} zoom={13} mapRef={mapRef1} />
                            {(() => {
                              const layer = BASE_LAYERS.find(l => l.id === baseLayer) || BASE_LAYERS[0];
                              return <TileLayer key={layer.id} attribution={layer.attribution} url={layer.url} maxZoom={layer.maxZoom || 19} crossOrigin={true} />;
                            })()}
                            <Marker position={[result.startCoords!.lat, result.startCoords!.lng]} icon={startIcon}>
                              <Tooltip permanent direction="top" offset={[0, -10]} className="font-bold text-[10px] uppercase bg-slate-900 text-white border-none rounded p-1 px-2 shadow-lg">INICIO</Tooltip>
                              <Popup>Punto de Inicio</Popup>
                            </Marker>
                            <Marker position={[result.endCoords!.lat, result.endCoords!.lng]} icon={endIcon}>
                              <Tooltip permanent direction="top" offset={[0, -10]} className="font-bold text-[10px] uppercase bg-blue-600 text-white border-none rounded p-1 px-2 shadow-lg">FINAL</Tooltip>
                              <Popup>Punto de Finalización</Popup>
                            </Marker>
                            <LeafletRouting
                              start={[result.startCoords!.lat, result.startCoords!.lng]}
                              end={[result.endCoords!.lat, result.endCoords!.lng]}
                            />
                          </MapContainer>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-4">
                          <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center gap-3">
                            <LocateFixed className="w-5 h-5 text-slate-400" />
                            <div>
                              <p className="text-[8px] font-bold text-slate-400 uppercase">Inicio</p>
                              <p className="text-[10px] font-mono text-slate-600">{result.startCoords!.lat.toFixed(8)}, {result.startCoords!.lng.toFixed(8)}</p>
                            </div>
                          </div>
                          <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center gap-3">
                            <LocateFixed className="w-5 h-5 text-blue-400" />
                            <div>
                              <p className="text-[8px] font-bold text-slate-400 uppercase">Final</p>
                              <p className="text-[10px] font-mono text-slate-600">{result.endCoords!.lat.toFixed(8)}, {result.endCoords!.lng.toFixed(8)}</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* MAP 2: ANEXO B */}
                      <div className="flex flex-col min-h-[400px] pt-8 border-t border-slate-200/60">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-[0.2em]">ANEXO B: TRAZADO VIAL CON MARCAS ADICIONALES (GRUPO A)</h3>
                        </div>

                        <div className="flex-1 rounded-2xl overflow-hidden border border-slate-200 relative shadow-inner aspect-[4/3] w-full min-h-[400px]">
                          <MapContainer
                            ref={mapRef2}
                            key={`map2-${result.startCoords!.lat}-${result.startCoords!.lng}-${result.endCoords!.lat}-${result.endCoords!.lng}-${image2Markers.map(m => `${m.lat},${m.lng}`).join('|')}`}
                            center={[result.startCoords!.lat, result.startCoords!.lng]}
                            zoom={13}
                            style={{ height: '100%', width: '100%' }}
                            scrollWheelZoom={false}
                          >
                            <CoordinateGrid useSatellite={useSatellite} />
                            <ChangeView center={[result.startCoords!.lat, result.startCoords!.lng]} zoom={13} mapRef={mapRef2} />
                            {(() => {
                              const layer = BASE_LAYERS.find(l => l.id === baseLayer) || BASE_LAYERS[0];
                              return <TileLayer key={layer.id} attribution={layer.attribution} url={layer.url} maxZoom={layer.maxZoom || 19} crossOrigin={true} />;
                            })()}
                            <Marker position={[result.startCoords!.lat, result.startCoords!.lng]} icon={startIcon}>
                              <Tooltip permanent direction="top" offset={[0, -10]} className="font-bold text-[10px] uppercase bg-slate-900 text-white border-none rounded p-1 px-2 shadow-lg">INICIO</Tooltip>
                              <Popup>Punto de Inicio</Popup>
                            </Marker>
                            <Marker position={[result.endCoords!.lat, result.endCoords!.lng]} icon={endIcon}>
                              <Tooltip permanent direction="top" offset={[0, -10]} className="font-bold text-[10px] uppercase bg-blue-600 text-white border-none rounded p-1 px-2 shadow-lg">FINAL</Tooltip>
                              <Popup>Punto de Finalización</Popup>
                            </Marker>
                            
                            {/* Additional Markers Group A */}
                            {image2Markers.map((m) => {
                              const lat = parseFloat(m.lat);
                              const lng = parseFloat(m.lng);
                              if (isNaN(lat) || isNaN(lng)) return null;
                              return (
                                <Marker key={m.id} position={[lat, lng]} icon={greenIcon}>
                                  <Tooltip permanent direction="top" offset={[0, -10]} className="font-bold text-[10px] uppercase bg-emerald-600 text-white border-none rounded p-1 px-2 shadow-lg">{m.label}</Tooltip>
                                  <Popup>{m.label || `Marca Adicional (${lat}, ${lng})`}</Popup>
                                </Marker>
                              );
                            })}

                            <LeafletRouting
                              start={[result.startCoords!.lat, result.startCoords!.lng]}
                              end={[result.endCoords!.lat, result.endCoords!.lng]}
                            />
                          </MapContainer>
                        </div>

                        {/* Coordinates list for Group A */}
                        <div className="mt-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Coordenadas del Grupo A</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {image2Markers.filter(m => !isNaN(parseFloat(m.lat)) && !isNaN(parseFloat(m.lng))).map((m, idx) => (
                              <div key={m.id} className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-150 shadow-sm text-xs">
                                <span className="font-bold text-slate-700">{m.label || `Marca A${idx + 1}`}</span>
                                <span className="font-mono text-[10px] text-slate-500">
                                  {parseFloat(m.lat).toFixed(8)}, {parseFloat(m.lng).toFixed(8)}
                                </span>
                              </div>
                            ))}
                            {image2Markers.filter(m => !isNaN(parseFloat(m.lat)) && !isNaN(parseFloat(m.lng))).length === 0 && (
                              <p className="text-[10px] text-slate-400 italic col-span-2 text-center py-2">No hay marcas adicionales configuradas en el Anexo B.</p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* MAP 3: ANEXO C */}
                      <div className="flex flex-col min-h-[400px] pt-8 border-t border-slate-200/60">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-[0.2em]">ANEXO C: TRAZADO VIAL CON MARCAS ADICIONALES (GRUPO B)</h3>
                        </div>

                        <div className="flex-1 rounded-2xl overflow-hidden border border-slate-200 relative shadow-inner aspect-[4/3] w-full min-h-[400px]">
                          <MapContainer
                            ref={mapRef3}
                            key={`map3-${result.startCoords!.lat}-${result.startCoords!.lng}-${result.endCoords!.lat}-${result.endCoords!.lng}-${image3Markers.map(m => `${m.lat},${m.lng}`).join('|')}`}
                            center={[result.startCoords!.lat, result.startCoords!.lng]}
                            zoom={13}
                            style={{ height: '100%', width: '100%' }}
                            scrollWheelZoom={false}
                          >
                            <CoordinateGrid useSatellite={useSatellite} />
                            <ChangeView center={[result.startCoords!.lat, result.startCoords!.lng]} zoom={13} mapRef={mapRef3} />
                            {(() => {
                              const layer = BASE_LAYERS.find(l => l.id === baseLayer) || BASE_LAYERS[0];
                              return <TileLayer key={layer.id} attribution={layer.attribution} url={layer.url} maxZoom={layer.maxZoom || 19} crossOrigin={true} />;
                            })()}
                            <Marker position={[result.startCoords!.lat, result.startCoords!.lng]} icon={startIcon}>
                              <Tooltip permanent direction="top" offset={[0, -10]} className="font-bold text-[10px] uppercase bg-slate-900 text-white border-none rounded p-1 px-2 shadow-lg">INICIO</Tooltip>
                              <Popup>Punto de Inicio</Popup>
                            </Marker>
                            <Marker position={[result.endCoords!.lat, result.endCoords!.lng]} icon={endIcon}>
                              <Tooltip permanent direction="top" offset={[0, -10]} className="font-bold text-[10px] uppercase bg-blue-600 text-white border-none rounded p-1 px-2 shadow-lg">FINAL</Tooltip>
                              <Popup>Punto de Finalización</Popup>
                            </Marker>
                            
                            {/* Additional Markers Group B */}
                            {image3Markers.map((m) => {
                              const lat = parseFloat(m.lat);
                              const lng = parseFloat(m.lng);
                              if (isNaN(lat) || isNaN(lng)) return null;
                              return (
                                <Marker key={m.id} position={[lat, lng]} icon={greenIcon}>
                                  <Tooltip permanent direction="top" offset={[0, -10]} className="font-bold text-[10px] uppercase bg-emerald-600 text-white border-none rounded p-1 px-2 shadow-lg">{m.label}</Tooltip>
                                  <Popup>{m.label || `Marca Adicional (${lat}, ${lng})`}</Popup>
                                </Marker>
                              );
                            })}

                            <LeafletRouting
                              start={[result.startCoords!.lat, result.startCoords!.lng]}
                              end={[result.endCoords!.lat, result.endCoords!.lng]}
                            />
                          </MapContainer>
                        </div>

                        {/* Coordinates list for Group B */}
                        <div className="mt-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Coordenadas del Grupo B</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {image3Markers.filter(m => !isNaN(parseFloat(m.lat)) && !isNaN(parseFloat(m.lng))).map((m, idx) => (
                              <div key={m.id} className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-150 shadow-sm text-xs">
                                <span className="font-bold text-slate-700">{m.label || `Marca B${idx + 1}`}</span>
                                <span className="font-mono text-[10px] text-slate-500">
                                  {parseFloat(m.lat).toFixed(8)}, {parseFloat(m.lng).toFixed(8)}
                                </span>
                              </div>
                            ))}
                            {image3Markers.filter(m => !isNaN(parseFloat(m.lat)) && !isNaN(parseFloat(m.lng))).length === 0 && (
                              <p className="text-[10px] text-slate-400 italic col-span-2 text-center py-2">No hay marcas adicionales configuradas en el Anexo C.</p>
                            )}
                          </div>
                        </div>
                      </div>

                    </div>
                  ) : (
                    <div className="mt-8 pt-8 border-t border-slate-100">
                      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-center">
                        <MapPin className="w-6 h-6 text-amber-400 mx-auto mb-2" />
                        <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Mapa no disponible</p>
                        <p className="text-[10px] text-amber-600 mt-1">Ingresa las coordenadas de inicio y fin en el panel izquierdo para visualizar el trazado.</p>
                      </div>
                    </div>
                  )}


                  <div className="mt-12 pt-8 border-t border-slate-100 flex justify-between items-end">
                    <div className="space-y-1">
                      <p className="text-[9px] font-mono text-slate-400 uppercase">Referencia Documental</p>
                      <p className="text-[10px] font-mono font-bold text-slate-500">GEO-{docId}-REPORT-PRO</p>
                    </div>
                    <div className="text-right space-y-2">
                       <p className="text-[9px] font-mono text-slate-400 uppercase">Firma Digital de Validación</p>
                       <div className="w-24 h-10 bg-slate-50 rounded border border-dashed border-slate-300 flex items-center justify-center">
                          <span className="text-[10px] font-serif italic text-slate-400 text-xs mt-1">IA Verified</span>
                       </div>
                    </div>
                  </div>
              </div>
            )}
          </section>
        </div>
        
        {/* Footer Instructions Bar */}
        <footer className="h-10 bg-blue-600 text-white flex items-center px-6 text-[10px] font-mono space-x-8 shrink-0 sticky bottom-0 z-30">
          <div className="flex items-center gap-2">
            <span className="bg-black/20 px-2 py-0.5 rounded text-blue-100">TERMINAL</span>
          </div>
          
          <div className="flex items-center gap-4 opacity-100">
            <span className="flex items-center space-x-2">
              <Play className="w-3 h-3 text-blue-300 fill-blue-300" />
              <span className="text-blue-100">pip install fpdf</span>
            </span>
            <div className="w-px h-3 bg-blue-500"></div>
            <span className="flex items-center space-x-2">
              <Play className="w-3 h-3 text-blue-300 fill-blue-300" />
              <span className="text-blue-100">python generator.py</span>
            </span>
          </div>

          <div className="flex-1 text-right opacity-70 uppercase tracking-widest flex items-center justify-end gap-2">
            <Check className="w-3 h-3" />
            STATUS: SISTEMA DE VALIDACIÓN ÓPTIMO
          </div>
        </footer>
      </main>
    </div>
  );
}

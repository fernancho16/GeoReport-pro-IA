import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FileText, MapPin, Navigation, Terminal, Copy, Check, Loader2, Sparkles, History, Layout, FileCode, ChevronRight, Share2, Play, Map as MapIcon, LocateFixed, Globe, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
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
}

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
function ChangeView({ center, zoom }: { center: [number, number], zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
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

export default function App() {
  const [description, setDescription] = useState('');
  const [projectName, setProjectName] = useState('');
  
  // Decimal states (used for API and Map)
  const [startLat, setStartLat] = useState('');
  const [startLng, setStartLng] = useState('');
  const [endLat, setEndLat] = useState('');
  const [endLng, setEndLng] = useState('');

  // DMS states
  const [useDMS, setUseDMS] = useState(false);
  const [useSatellite, setUseSatellite] = useState(false);
  const [dmsStartFull, setDmsStartFull] = useState('');
  const [dmsEndFull, setDmsEndFull] = useState('');
  const [dmsStartLat, setDmsStartLat] = useState({ d: '', m: '', s: '', dir: 'N' });
  const [dmsStartLng, setDmsStartLng] = useState({ d: '', m: '', s: '', dir: 'W' });
  const [dmsEndLat, setDmsEndLat] = useState({ d: '', m: '', s: '', dir: 'N' });
  const [dmsEndLng, setDmsEndLng] = useState({ d: '', m: '', s: '', dir: 'W' });
  
  const [files, setFiles] = useState<{ data: string; mimeType: string; name: string; id: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerationResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

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
          lat: parseFloat(sLat || startLat || result.startCoords.lat.toString()), 
          lng: parseFloat(sLng || startLng || result.startCoords.lng.toString()) 
        },
        endCoords: { 
          lat: parseFloat(eLat || endLat || result.endCoords.lat.toString()), 
          lng: parseFloat(eLng || endLng || result.endCoords.lng.toString()) 
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
          projectName,
          startCoords: startLat && startLng ? { lat: parseFloat(startLat), lng: parseFloat(startLng) } : null,
          endCoords: endLat && endLng ? { lat: parseFloat(endLat), lng: parseFloat(endLng) } : null,
        }),
      });
      
      if (!response.ok) throw new Error('Error al generar el informe');
      
      const data = await response.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message);
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
    if (!reportRef.current) return;
    
    setLoading(true);
    try {
      // Ensure we are at the top for proper capture
      window.scrollTo(0, 0);
      
      // Wait a bit for map tiles to be fully stable
      await new Promise(resolve => setTimeout(resolve, 800));
      
      const element = reportRef.current;
      
      // Hide buttons during capture
      const buttons = element.querySelectorAll('button');
      buttons.forEach(btn => {
        if (btn instanceof HTMLElement) btn.style.visibility = 'hidden';
      });
      
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        logging: false,
        backgroundColor: "#ffffff",
        imageTimeout: 15000, // Increase timeout for map tiles
        onclone: (clonedDoc) => {
          // You can perform last minute DOM changes on the clone here
        }
      });
      
      // Restore buttons
      buttons.forEach(btn => {
        if (btn instanceof HTMLElement) btn.style.visibility = 'visible';
      });
      
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      const imgProps = pdf.getImageProperties(imgData);
      const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      let heightLeft = imgHeight;
      let position = 0;
      
      pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, imgHeight);
      heightLeft -= pdfHeight;
      
      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, imgHeight);
        heightLeft -= pdfHeight;
      }
      
      // blob processing for safer download in some iframes
      const blob = pdf.output('blob');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${projectName || 'Reporte-Localizacion'}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

    } catch (err) {
      console.error("Error generating PDF:", err);
      setError("Error al generar el PDF. Asegúrate de que el mapa haya cargado completamente.");
    } finally {
      setLoading(false);
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
            <span>Motor Gemini Activo</span>
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
              disabled={loading || !description.trim()}
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
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
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
                </motion.div>
              )}
            </div>
          </section>

          {/* Right Pane: Technical Report Output */}
          <section className="bg-slate-50 flex flex-col p-8">
            <AnimatePresence mode="wait">
              {!result && !loading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4"
                >
                  <MapPin className="w-12 h-12 opacity-10" />
                  <p className="text-xs font-bold uppercase tracking-widest">Esperando Parámetros de Ruta</p>
                </motion.div>
              )}

              {loading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="h-full flex flex-col items-center justify-center space-y-6"
                >
                  <div className="relative">
                    <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin"></div>
                    <Navigation className="w-4 h-4 text-blue-500 absolute inset-0 m-auto animate-pulse" />
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-800">Generando Reporte</p>
                    <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider">Georreferenciando puntos de interés...</p>
                  </div>
                </motion.div>
              )}

              {result && !loading && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  ref={reportRef}
                  className="max-w-2xl mx-auto w-full bg-white shadow-2xl border border-slate-200 p-12 min-h-full flex flex-col relative"
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
                  {result.startCoords && result.endCoords && (
                    <div className="mt-8 pt-8 border-t border-slate-100 flex-1 flex flex-col min-h-[400px]">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xs font-bold text-slate-900 uppercase tracking-[0.2em]">ANEXO: GEORREFERENCIACIÓN Y TRAZADO VIAL</h3>
                        <div className="flex items-center gap-2">
                              {API_KEY && (
                            <button 
                              onClick={() => {
                                const current = localStorage.getItem('forceFreeMap') === 'true';
                                localStorage.setItem('forceFreeMap', (!current).toString());
                                window.location.reload();
                              }}
                              className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded font-bold uppercase flex items-center gap-1 transition-colors"
                            >
                              <Globe className="w-3 h-3" />
                              {localStorage.getItem('forceFreeMap') === 'true' ? 'Google Maps' : 'Mapa Libre'}
                            </button>
                          )}
                          <button 
                            onClick={() => setUseSatellite(!useSatellite)}
                            className={`text-[10px] px-2 py-1 rounded font-bold uppercase flex items-center gap-1 transition-colors ${
                              useSatellite ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            <MapIcon className="w-3 h-3" />
                            {useSatellite ? 'Vista Plano' : 'Vista Satélite'}
                          </button>
                          {result.projectName && (
                            <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded font-bold uppercase">{result.projectName}</span>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex-1 rounded-2xl overflow-hidden border border-slate-200 relative shadow-inner h-[300px]">
                        {API_KEY && !useMemo(() => localStorage.getItem('forceFreeMap') === 'true', []) ? (
                          <APIProvider apiKey={API_KEY} version="weekly">
                            <GoogleMap
                              defaultCenter={result.startCoords}
                              defaultZoom={13}
                              mapId="DEMO_MAP_ID"
                              mapTypeId={useSatellite ? 'hybrid' : 'roadmap'}
                              style={{ width: '100%', height: '100%' }}
                              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                              disableDefaultUI={true}
                              gestureHandling={'cooperative'}
                            >
                              <AdvancedMarker position={result.startCoords}>
                                <GooglePin background="#1e293b" borderColor="#fff" glyphColor="#fff">
                                  <div className="p-1 px-2 text-[10px] font-bold text-white whitespace-nowrap bg-slate-900 rounded-full border border-white absolute -top-8 left-1/2 -translate-x-1/2 shadow-lg">INICIO</div>
                                </GooglePin>
                              </AdvancedMarker>
                              
                              <AdvancedMarker position={result.endCoords}>
                                <GooglePin background="#2563eb" borderColor="#fff" glyphColor="#fff">
                                  <div className="p-1 px-2 text-[10px] font-bold text-white whitespace-nowrap bg-blue-600 rounded-full border border-white absolute -top-8 left-1/2 -translate-x-1/2 shadow-lg">FINAL</div>
                                </GooglePin>
                              </AdvancedMarker>

                              <RoutePolyline start={result.startCoords} end={result.endCoords} />
                            </GoogleMap>
                          </APIProvider>
                        ) : (
                          <MapContainer 
                            center={[result.startCoords.lat, result.startCoords.lng]} 
                            zoom={13} 
                            style={{ height: '100%', width: '100%' }}
                            scrollWheelZoom={false}
                          >
                            <ChangeView center={[result.startCoords.lat, result.startCoords.lng]} zoom={13} />
                            {useSatellite ? (
                              <TileLayer
                                attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                                crossOrigin={true}
                              />
                            ) : (
                              <TileLayer
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                crossOrigin={true}
                              />
                            )}
                            <Marker position={[result.startCoords.lat, result.startCoords.lng]}>
                              <Tooltip permanent direction="top" offset={[0, -20]} className="font-bold text-[10px] uppercase bg-slate-900 text-white border-none rounded p-1 px-2 shadow-lg">INICIO</Tooltip>
                              <Popup>Punto de Inicio</Popup>
                            </Marker>
                            <Marker position={[result.endCoords.lat, result.endCoords.lng]}>
                              <Tooltip permanent direction="top" offset={[0, -20]} className="font-bold text-[10px] uppercase bg-blue-600 text-white border-none rounded p-1 px-2 shadow-lg">FINAL</Tooltip>
                              <Popup>Punto de Finalización</Popup>
                            </Marker>
                            <LeafletRouting 
                              start={[result.startCoords.lat, result.startCoords.lng]} 
                              end={[result.endCoords.lat, result.endCoords.lng]} 
                            />
                          </MapContainer>
                        )}
                      </div>
                      
                      <div className="mt-4 grid grid-cols-2 gap-4">
                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center gap-3">
                          <LocateFixed className="w-5 h-5 text-slate-400" />
                          <div>
                            <p className="text-[8px] font-bold text-slate-400 uppercase">Inicio</p>
                            <p className="text-[10px] font-mono text-slate-600">{result.startCoords.lat.toFixed(8)}, {result.startCoords.lng.toFixed(8)}</p>
                          </div>
                        </div>
                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center gap-3">
                          <LocateFixed className="w-5 h-5 text-blue-400" />
                          <div>
                            <p className="text-[8px] font-bold text-slate-400 uppercase">Final</p>
                            <p className="text-[10px] font-mono text-slate-600">{result.endCoords.lat.toFixed(8)}, {result.endCoords.lng.toFixed(8)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-12 pt-8 border-t border-slate-100 flex justify-between items-end">
                    <div className="space-y-1">
                      <p className="text-[9px] font-mono text-slate-400 uppercase">Referencia Documental</p>
                      <p className="text-[10px] font-mono font-bold text-slate-500">GEO-{Math.floor(Math.random() * 900) + 100}-REPORT-PRO</p>
                    </div>
                    <div className="text-right space-y-2">
                       <p className="text-[9px] font-mono text-slate-400 uppercase">Firma Digital de Validación</p>
                       <div className="w-24 h-10 bg-slate-50 rounded border border-dashed border-slate-300 flex items-center justify-center">
                          <span className="text-[10px] font-serif italic text-slate-400 text-xs mt-1">IA Verified</span>
                       </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
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

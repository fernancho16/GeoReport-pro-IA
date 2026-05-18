import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ─────────────────────────────────────────────
// SYSTEM PROMPT (shared by all providers)
// ─────────────────────────────────────────────
const SYSTEM_INSTRUCTIONS = `
Rol:
Eres un Asistente Especialista en Documentación Técnica y Generación de Reportes Geográficos. Tu función es transformar descripciones informales, transcripciones de audio o documentos técnicos (PDF/Texto) sobre rutas y trayectos en capítulos estructurados de "Localización del Sitio" para informes profesionales.

Objetivo:
Analizar: Interpretar rutas, puntos de referencia, distancias, giros, y DATOS DEL PROYECTO (Nombre del Proyecto, Vereda, Número de Convenio).
Redactar: Generar un texto técnico estructurado con títulos (Punto de Partida, Trayecto, Giros Críticos, Accesibilidad).
Automatizar: Proporcionar siempre un bloque de código en Python (usando la librería fpdf) que permite al usuario generar automáticamente un documento PDF con la información redactada.

Pautas de Redacción:
- Usa un tono formal y técnico.
- Organiza la información en listas numeradas o puntos clave.
- Asegúrate de mencionar el tipo de vía (pavimentada, destapada) y la transitabilidad (tipos de vehículos).

Pautas del Código Python:
- El código debe usar 'from fpdf import FPDF'.
- Debe incluir una clase que maneje encabezados y pies de página.
- El texto dentro del código debe estar limpio de errores de codificación para que funcione en cualquier terminal (especialmente Windows PowerShell).

Estructura de Respuesta Esperada:
1. Título del Capítulo.
2. Cuerpo del informe estructurado (Punto de Partida, Trayecto, Giros Críticos, Accesibilidad).
3. Sección de Código: Un bloque de código Python listo para copiar.
4. Instrucciones de Ejecución: Breves pasos para instalar pip install fpdf y ejecutar el script en la terminal.

IMPORTANTE:
- Proactivamente busca el 'Nombre del Proyecto', 'Vereda' y 'Número de Convenio' en los archivos adjuntos o descripciones.
- Responde en Español.
- Tu respuesta DEBE ser un objeto JSON válido con exactamente estos campos:
  {
    "report": "texto del informe en markdown",
    "code": "código python completo",
    "execution_instructions": "pasos para ejecutar",
    "projectName": "nombre del proyecto o vacío",
    "vereda": "vereda o vacío",
    "convenioNumber": "número de convenio o vacío",
    "startCoords": { "lat": 0.0, "lng": 0.0 } o null,
    "endCoords": { "lat": 0.0, "lng": 0.0 } o null
  }
`;

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
interface GenerationInput {
  description: string;
  projectName?: string;
  startCoords?: { lat: number; lng: number } | null;
  endCoords?: { lat: number; lng: number } | null;
  files?: { data: string; mimeType: string; name?: string }[];
  file?: { data: string; mimeType: string };
  provider?: string;
}

interface ReportData {
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

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function isQuotaError(error: any): boolean {
  const msg = String(error?.message || error || "").toLowerCase();
  const status = error?.status || error?.code || error?.httpError;
  return (
    status === 429 ||
    msg.includes("429") ||
    msg.includes("resource_exhausted") ||
    msg.includes("quota") ||
    msg.includes("rate_limit") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests")
  );
}

function buildContextText(input: GenerationInput): string {
  let ctx = "";
  if (input.projectName) ctx += `Proyecto/Tramo: ${input.projectName}\n`;
  if (input.startCoords) ctx += `Coordenadas de Inicio: Lat ${input.startCoords.lat}, Lng ${input.startCoords.lng}\n`;
  if (input.endCoords) ctx += `Coordenadas de Fin: Lat ${input.endCoords.lat}, Lng ${input.endCoords.lng}\n`;
  return ctx;
}

function applyFallbacks(data: ReportData, input: GenerationInput): ReportData {
  if (!data.startCoords && input.startCoords) data.startCoords = input.startCoords;
  if (!data.endCoords && input.endCoords) data.endCoords = input.endCoords;
  if (!data.projectName && input.projectName) data.projectName = input.projectName;
  if (!data.vereda) data.vereda = "";
  if (!data.convenioNumber) data.convenioNumber = "";
  return data;
}

// ─────────────────────────────────────────────
// PROVIDER 1: GEMINI (supports files/audio)
// ─────────────────────────────────────────────
async function generateWithGemini(input: GenerationInput): Promise<ReportData> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { "User-Agent": "aistudio-build" } },
  });

  const parts: any[] = [];
  const ctx = buildContextText(input);
  if (ctx) parts.push({ text: `CONTEXTO ADICIONAL:\n${ctx}` });
  if (input.description) parts.push({ text: `DESCRIPCIÓN DEL USUARIO:\n${input.description}` });
  if (input.file) parts.push({ inlineData: { data: input.file.data, mimeType: input.file.mimeType } });
  if (input.files?.length) {
    input.files.forEach((f) => parts.push({ inlineData: { data: f.data, mimeType: f.mimeType } }));
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ parts }],
    config: {
      systemInstruction: SYSTEM_INSTRUCTIONS,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          report: { type: "STRING" },
          code: { type: "STRING" },
          execution_instructions: { type: "STRING" },
          projectName: { type: "STRING" },
          vereda: { type: "STRING" },
          convenioNumber: { type: "STRING" },
          startCoords: { type: "OBJECT", properties: { lat: { type: "NUMBER" }, lng: { type: "NUMBER" } } },
          endCoords: { type: "OBJECT", properties: { lat: { type: "NUMBER" }, lng: { type: "NUMBER" } } },
        },
        required: ["report", "code", "execution_instructions"],
      },
    },
  });

  const data = JSON.parse(response.text || "{}");
  return { ...applyFallbacks(data, input), _provider: "Gemini" };
}

// ─────────────────────────────────────────────
// PROVIDER 2: GROQ (free tier, very fast)
// Models: llama-3.3-70b-versatile, mixtral-8x7b-32768
// Limit: 30 RPM, 14,400 RPD (free)
// NOTE: Text only — files are described as text
// ─────────────────────────────────────────────
async function generateWithGroq(input: GenerationInput): Promise<ReportData> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not configured");

  const ctx = buildContextText(input);
  const fileNote = input.files?.length
    ? `\n[NOTA: El usuario adjuntó ${input.files.length} archivo(s): ${input.files.map((f) => f.name || f.mimeType).join(", ")}. Analiza la descripción para inferir la información de localización.]`
    : "";

  const userContent = `${ctx ? `CONTEXTO:\n${ctx}\n` : ""}DESCRIPCIÓN:\n${input.description || "Genera el informe de localización con la información disponible."}${fileNote}`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_INSTRUCTIONS },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const err: any = await response.json().catch(() => ({}));
    const error: any = new Error(err.error?.message || `Groq HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const resp: any = await response.json();
  const data = JSON.parse(resp.choices[0].message.content);
  return { ...applyFallbacks(data, input), _provider: "Groq (Llama 3.3)" };
}

// ─────────────────────────────────────────────
// PROVIDER 3: OPENROUTER (aggregates many models)
// Free models change often on OpenRouter.
// Keep the default configurable and point it to a currently available free model.
// ─────────────────────────────────────────────
async function generateWithOpenRouter(input: GenerationInput): Promise<ReportData> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");
  const model = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash:free";

  const ctx = buildContextText(input);
  const fileNote = input.files?.length
    ? `\n[Archivos adjuntos: ${input.files.map((f) => f.name || f.mimeType).join(", ")}]`
    : "";

  const userContent = `${ctx ? `CONTEXTO:\n${ctx}\n` : ""}DESCRIPCIÓN:\n${input.description || "Genera el informe de localización."}${fileNote}`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "GeoReport Pro IA",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_INSTRUCTIONS },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const err: any = await response.json().catch(() => ({}));
    const error: any = new Error(err.error?.message || `OpenRouter HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const resp: any = await response.json();
  const content = resp.choices?.[0]?.message?.content || "{}";
  const data = JSON.parse(content);
  return { ...applyFallbacks(data, input), _provider: `OpenRouter (${model})` };
}

// ─────────────────────────────────────────────
// PROVIDER 4: OPENCODE (OpenAI-compatible endpoint)
// Configure OPENCODE_BASE_URL, OPENCODE_MODEL and optionally OPENCODE_API_KEY
// ─────────────────────────────────────────────
async function generateWithOpenCode(input: GenerationInput): Promise<ReportData> {
  const baseUrl = process.env.OPENCODE_BASE_URL;
  const model = process.env.OPENCODE_MODEL;
  if (!baseUrl || !model) {
    throw new Error("OPENCODE_BASE_URL or OPENCODE_MODEL not configured");
  }

  const apiKey = process.env.OPENCODE_API_KEY;
  const ctx = buildContextText(input);
  const fileNote = input.files?.length
    ? `\n[Archivos adjuntos: ${input.files.map((f) => f.name || f.mimeType).join(", ")}]`
    : "";

  const userContent = `${ctx ? `CONTEXTO:\n${ctx}\n` : ""}DESCRIPCIÓN:\n${input.description || "Genera el informe de localización."}${fileNote}`;
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_INSTRUCTIONS },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const err: any = await response.json().catch(() => ({}));
    const error: any = new Error(err.error?.message || `OpenCode HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const resp: any = await response.json();
  const content = resp.choices?.[0]?.message?.content || "{}";
  const data = JSON.parse(content);
  return { ...applyFallbacks(data, input), _provider: `OpenCode (${model})` };
}

function getProviders(input: GenerationInput) {
  return [
    { id: "gemini", name: "Gemini", fn: () => generateWithGemini(input), enabled: !!process.env.GEMINI_API_KEY },
    { id: "groq", name: "Groq", fn: () => generateWithGroq(input), enabled: !!process.env.GROQ_API_KEY },
    { id: "openrouter", name: "OpenRouter", fn: () => generateWithOpenRouter(input), enabled: !!process.env.OPENROUTER_API_KEY },
    { id: "opencode", name: "OpenCode", fn: () => generateWithOpenCode(input), enabled: !!process.env.OPENCODE_BASE_URL && !!process.env.OPENCODE_MODEL },
  ];
}

// ─────────────────────────────────────────────
// CASCADE FALLBACK ENGINE
// ─────────────────────────────────────────────
async function generateWithFallback(input: GenerationInput): Promise<ReportData> {
  const providers = getProviders(input).filter((p) => p.enabled);

  if (providers.length === 0) {
    throw new Error("No hay API keys configuradas. Agrega GEMINI_API_KEY, GROQ_API_KEY o OPENROUTER_API_KEY en el archivo .env");
  }

  let lastError: any;
  const tried: string[] = [];

  for (const provider of providers) {
    try {
      console.log(`[AI] Intentando con ${provider.name}...`);
      const result = await provider.fn();
      console.log(`[AI] ✓ ${provider.name} respondió correctamente`);
      if (tried.length > 0) {
        console.log(`[AI] Fallback activado: ${tried.join(" → ")} fallaron`);
      }
      return result;
    } catch (error: any) {
      tried.push(provider.name);
      const quota = isQuotaError(error);
      console.warn(`[AI] ✗ ${provider.name} falló${quota ? " (cuota agotada)" : ""}: ${error.message}`);
      lastError = error;

      // Only continue cascade for quota/rate errors
      if (!quota) throw error;
    }
  }

  // All providers exhausted
  const triedNames = tried.join(", ");
  throw new Error(
    `Cuota agotada en todos los proveedores configurados (${triedNames}). ` +
    `Agrega una GROQ_API_KEY o OPENROUTER_API_KEY en .env para continuar. ` +
    `Error original: ${lastError?.message}`
  );
}

async function generateWithSelectedProvider(input: GenerationInput): Promise<ReportData> {
  if (!input.provider || input.provider === "auto") {
    return generateWithFallback(input);
  }

  const provider = getProviders(input).find((p) => p.id === input.provider);
  if (!provider) {
    throw new Error(`Proveedor no soportado: ${input.provider}`);
  }
  if (!provider.enabled) {
    throw new Error(`Proveedor no configurado: ${provider.name}`);
  }

  return provider.fn();
}

// ─────────────────────────────────────────────
// API ROUTE
// ─────────────────────────────────────────────
app.post("/api/generate-report", async (req, res) => {
  const { description, files, file, projectName, startCoords, endCoords, provider } = req.body;

  if (!description && !files && !file) {
    return res.status(400).json({ error: "Se requiere descripción o archivos" });
  }

  try {
    const input: GenerationInput = {
      description: description || "Analiza los archivos adjuntos para generar el informe de localización.",
      projectName,
      startCoords,
      endCoords,
      files,
      file,
      provider,
    };

    const data = await generateWithSelectedProvider(input);
    res.json(data);
  } catch (error: any) {
    console.error("[API] Error final:", error.message);
    const message = error?.message || "Error al generar el informe";
    res.status(500).json({ error: message });
  }
});

// Status endpoint to see which providers are configured
app.get("/api/providers", (_req, res) => {
  res.json({
    providers: [
      { id: "auto", name: "Auto (fallback)", configured: true, supportsFiles: true },
      { id: "gemini", name: "Gemini 2.0 Flash", configured: !!process.env.GEMINI_API_KEY, supportsFiles: true },
      { id: "groq", name: "Groq (Llama 3.3 70B)", configured: !!process.env.GROQ_API_KEY, supportsFiles: false },
      { id: "openrouter", name: `OpenRouter (${process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash:free"})`, configured: !!process.env.OPENROUTER_API_KEY, supportsFiles: false },
      { id: "opencode", name: `OpenCode (${process.env.OPENCODE_MODEL || "sin modelo"})`, configured: !!process.env.OPENCODE_BASE_URL && !!process.env.OPENCODE_MODEL, supportsFiles: false },
    ],
  });
});

// ─────────────────────────────────────────────
// SERVER STARTUP
// ─────────────────────────────────────────────
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🚀 GeoReport Pro IA corriendo en http://localhost:${PORT}`);
    console.log(`📡 Proveedores configurados:`);
    if (process.env.GEMINI_API_KEY) console.log(`   ✓ Gemini 2.0 Flash (con soporte de archivos)`);
    if (process.env.GROQ_API_KEY) console.log(`   ✓ Groq - Llama 3.3 70B (fallback rápido)`);
    if (process.env.OPENROUTER_API_KEY) console.log(`   ✓ OpenRouter - ${process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash:free"} (fallback final)`);
    if (process.env.OPENCODE_BASE_URL && process.env.OPENCODE_MODEL) console.log(`   ✓ OpenCode - ${process.env.OPENCODE_MODEL}`);
    if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY && !(process.env.OPENCODE_BASE_URL && process.env.OPENCODE_MODEL)) {
      console.warn(`   ⚠️  Sin API keys configuradas en .env`);
    }
    console.log("");
  });
}

startServer();

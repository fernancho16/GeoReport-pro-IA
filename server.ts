import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Initialize Gemini
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

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
- Responde en el mismo idioma que el usuario (Español). 
- La respuesta debe ser un objeto JSON siguiendo el esquema proporcionado.
`;

app.post("/api/generate-report", async (req, res) => {
  const { description, files, file, projectName, startCoords, endCoords } = req.body;

  if (!description && !files && !file) {
    return res.status(400).json({ error: "Description or files are required" });
  }

  try {
    const parts: any[] = [];
    
    let contextText = "";
    if (projectName) contextText += `Proyecto/Tramo: ${projectName}\n`;
    if (startCoords) contextText += `Coordenadas de Inicio: Lat ${startCoords.lat}, Lng ${startCoords.lng}\n`;
    if (endCoords) contextText += `Coordenadas de Fin: Lat ${endCoords.lat}, Lng ${endCoords.lng}\n`;
    
    if (contextText) {
      parts.push({ text: `CONTEXTO ADICIONAL:\n${contextText}` });
    }

    if (description) {
      parts.push({ text: `DESCRIPCIÓN DEL USUARIO:\n${description}` });
    }
    
    // Support both single file (old) and multiple files (new)
    if (file) {
      parts.push({
        inlineData: {
          data: file.data,
          mimeType: file.mimeType
        }
      });
    }

    if (files && Array.isArray(files)) {
      files.forEach(f => {
        parts.push({
          inlineData: {
            data: f.data,
            mimeType: f.mimeType
          }
        });
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ parts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTIONS + "\nIMPORTANTE: Si se proporcionan coordenadas o un nombre de proyecto, asegúrate de incluirlos de manera técnica en el cuerpo del informe.",
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
            startCoords: {
              type: "OBJECT",
              properties: {
                lat: { type: "NUMBER" },
                lng: { type: "NUMBER" }
              }
            },
            endCoords: {
              type: "OBJECT",
              properties: {
                lat: { type: "NUMBER" },
                lng: { type: "NUMBER" }
              }
            }
          },
          required: ["report", "code", "execution_instructions"]
        }
      },
    });

    const data = JSON.parse(response.text || "{}");
    
    // Ensure we return the values if Gemini didn't (fallback)
    if (!data.startCoords && startCoords) data.startCoords = startCoords;
    if (!data.endCoords && endCoords) data.endCoords = endCoords;
    if (!data.projectName && projectName) data.projectName = projectName;
    if (!data.vereda) data.vereda = "";
    if (!data.convenioNumber) data.convenioNumber = "";

    res.json(data);
  } catch (error: any) {
    console.error("Gemini Error:", error);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

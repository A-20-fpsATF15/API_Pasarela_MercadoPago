// ============================================================
// server.js - Pasarela MercadoPago - Abarrotes Oly
// Nivel: Producción / Seguridad Bancaria
// ============================================================

"use strict";

// ── 1. DEPENDENCIAS ─────────────────────────────────────────
const express = require("express");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");
const dotenv = require("dotenv");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto"); // nativo de Node.js

// ── 2. CARGAR VARIABLES DE ENTORNO ──────────────────────────
dotenv.config();

// ── 3. VALIDAR QUE EXISTEN LAS VARIABLES CRÍTICAS ───────────
const REQUIRED_ENV = [
  "MP_ACCESS_TOKEN_TEST",
  "MP_PUBLIC_KEY_TEST",
  "MP_ACCESS_TOKEN_PROD",
  "MP_PUBLIC_KEY_PROD",
  "FRONTEND_URL",
  "SUCCESS_URL",
  "FAILURE_URL",
  "PENDING_URL",
];

REQUIRED_ENV.forEach((key) => {
  if (!process.env[key]) {
    console.error(`❌ FATAL: Variable de entorno faltante → ${key}`);
    process.exit(1); // Detiene el servidor si falta algo crítico
  }
});

// ── 4. SELECCIONAR CREDENCIALES SEGÚN EL MODO ───────────────
const isProduction = process.env.NODE_ENV === "production";

const ACCESS_TOKEN = isProduction
  ? process.env.MP_ACCESS_TOKEN_PROD
  : process.env.MP_ACCESS_TOKEN_TEST;

const PUBLIC_KEY = isProduction
  ? process.env.MP_PUBLIC_KEY_PROD
  : process.env.MP_PUBLIC_KEY_TEST;

console.log(`🚀 Modo: ${isProduction ? "PRODUCCIÓN 🟢" : "SANDBOX 🟡"}`);

// ── 5. CONFIGURAR MERCADOPAGO ────────────────────────────────
const mpClient = new MercadoPagoConfig({
  accessToken: ACCESS_TOKEN,
  options: {
    timeout: 5000, // 5 segundos máximo de espera
  },
});

const preferenceClient = new Preference(mpClient);
const paymentClient = new Payment(mpClient);

// ── 6. INICIAR EXPRESS ───────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

// ── 7. SEGURIDAD: HELMET (Headers HTTP seguros) ──────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://sdk.mercadopago.com"],
        connectSrc: ["'self'", "https://api.mercadopago.com"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000, // 1 año en segundos
      includeSubDomains: true,
      preload: true,
    },
  })
);

// ── 8. SEGURIDAD: CORS ESTRICTO ──────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:3000",
  "http://127.0.0.1:5500", // Live Server de VS Code
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Permite peticiones sin origin (Postman, curl) solo en desarrollo
      if (!origin && !isProduction) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      console.warn(`⚠️ CORS bloqueado para origen: ${origin}`);
      return callback(new Error("No permitido por CORS"));
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "x-idempotency-key"],
    credentials: true,
  })
);

// ── 9. SEGURIDAD: RATE LIMITING ──────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // Ventana de 15 minutos
  max: 50,                   // Máximo 50 peticiones por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Demasiadas peticiones. Intenta de nuevo en 15 minutos.",
  },
});

// Rate limit más estricto para el endpoint de pagos
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10,             // Máximo 10 intentos de pago por minuto
  message: {
    error: "Demasiados intentos de pago. Espera un momento.",
  },
});

app.use(limiter);

// ── 10. PARSEAR JSON CON LÍMITE DE TAMAÑO ───────────────────
app.use(express.json({ limit: "10kb" })); // Máximo 10kb por petición

// ── 11. FUNCIÓN: VALIDAR DATOS DEL PAGO ─────────────────────
function validatePaymentData(data) {
  const errors = [];

  // Validar título
  if (!data.title || typeof data.title !== "string" || data.title.trim().length < 3) {
    errors.push("El título del producto es inválido.");
  }

  // Validar cantidad
  if (!Number.isInteger(data.quantity) || data.quantity < 1 || data.quantity > 999) {
    errors.push("La cantidad debe ser un número entero entre 1 y 999.");
  }

  // Validar precio unitario
  if (
    typeof data.unit_price !== "number" ||
    isNaN(data.unit_price) ||
    data.unit_price <= 0 ||
    data.unit_price > 999999
  ) {
    errors.push("El precio unitario debe ser un número positivo válido.");
  }

  // Validar email del comprador (opcional pero si viene debe ser válido)
  if (data.payer_email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.payer_email)) {
      errors.push("El email del comprador no es válido.");
    }
  }

  return errors;
}

// ── 12. FUNCIÓN: SANITIZAR STRINGS ──────────────────────────
function sanitize(str) {
  if (typeof str !== "string") return str;
  return str
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .trim()
    .substring(0, 255); // Máximo 255 caracteres
}

// ── 13. RUTA: HEALTH CHECK ───────────────────────────────────
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    mode: isProduction ? "production" : "sandbox",
    timestamp: new Date().toISOString(),
  });
});

// ── 14. RUTA: OBTENER PUBLIC KEY (para el frontend) ──────────
app.get("/api/public-key", (req, res) => {
  res.status(200).json({ publicKey: PUBLIC_KEY });
});

// ── 15. RUTA PRINCIPAL: CREAR PREFERENCIA DE PAGO ───────────
app.post("/api/create-preference", paymentLimiter, async (req, res) => {
  try {
    const { title, quantity, unit_price, payer_email } = req.body;

    // 15.1 Validar datos entrantes
    const errors = validatePaymentData({ title, quantity, unit_price, payer_email });
    if (errors.length > 0) {
      return res.status(400).json({ error: "Datos inválidos", details: errors });
    }

    // 15.2 Sanitizar datos
    const safeTitle = sanitize(title);
    const safeEmail = payer_email ? sanitize(payer_email) : null;

    // 15.3 Clave de idempotencia (evita cobros duplicados)
    const idempotencyKey = crypto.randomUUID();

    // 15.4 Construir preferencia
    const preferenceData = {
      items: [
        {
          title: safeTitle,
          quantity: Number(quantity),
          unit_price: Number(unit_price),
          currency_id: "MXN",
        },
      ],
      payer: safeEmail ? { email: safeEmail } : undefined,
      back_urls: {
        success: process.env.SUCCESS_URL,
        failure: process.env.FAILURE_URL,
        pending: process.env.PENDING_URL,
      },
      auto_return: "approved", // Regresa automáticamente si es aprobado
      statement_descriptor: "ABARROTES OLY",
      external_reference: idempotencyKey, // Para rastrear el pago
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // Expira en 30 min
    };

    // 15.5 Crear preferencia en MercadoPago
    const preference = await preferenceClient.create({
      body: preferenceData,
      requestOptions: { idempotencyKey },
    });

    console.log(`✅ Preferencia creada: ${preference.id} | Ref: ${idempotencyKey}`);

    // 15.6 Responder al frontend
    return res.status(201).json({
      preferenceId: preference.id,
      initPoint: preference.init_point,         // URL de pago PRODUCCIÓN
      sandboxInitPoint: preference.sandbox_init_point, // URL de pago SANDBOX
    });

  } catch (error) {
    console.error("❌ Error al crear preferencia:", error?.message || error);
    return res.status(500).json({
      error: "Error interno al procesar el pago. Intenta de nuevo.",
    });
  }
});

// ── 16. RUTA: WEBHOOK (MercadoPago notifica el resultado) ────
app.post("/api/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === "payment") {
      const paymentId = data?.id;
      if (!paymentId) return res.sendStatus(400);

      // Consultar el pago directamente a MP (nunca confiar en el body)
      const payment = await paymentClient.get({ id: paymentId });

      console.log(`📩 Webhook recibido | Pago: ${paymentId} | Estado: ${payment.status}`);

      // Aquí puedes guardar en base de datos, enviar email, etc.
      // Por ahora solo logueamos
    }

    return res.sendStatus(200);

  } catch (error) {
    console.error("❌ Error en webhook:", error?.message || error);
    return res.sendStatus(500);
  }
});

// ── 17. MANEJO DE RUTAS NO ENCONTRADAS ──────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada." });
});

// ── 18. MANEJO GLOBAL DE ERRORES ────────────────────────────
app.use((err, req, res, next) => {
  if (err.message === "No permitido por CORS") {
    return res.status(403).json({ error: "Acceso no permitido." });
  }
  console.error("❌ Error no manejado:", err);
  return res.status(500).json({ error: "Error interno del servidor." });
});

// ── 19. INICIAR SERVIDOR ─────────────────────────────────────
app.listen(PORT, () => {
  console.log("════════════════════════════════════════");
  console.log(`  🛒 Pasarela Abarrotes Oly`);
  console.log(`  🌐 Puerto: ${PORT}`);
  console.log(`  🔐 Modo: ${isProduction ? "PRODUCCIÓN" : "SANDBOX"}`);
  console.log("════════════════════════════════════════");
});
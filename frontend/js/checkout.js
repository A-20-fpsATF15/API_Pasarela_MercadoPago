/* ============================================================
   checkout.js — Lógica del formulario de pago
   Tienda Oly · Pasarela MercadoPago
   ============================================================ */

"use strict";

// ── CONFIGURACIÓN ────────────────────────────────────────────
const API_URL = "https://pasarela-oly.onrender.com"; // Cambiar al URL de Render al desplegar

// ── LEER PARÁMETROS DE URL ───────────────────────────────────
// Tu tienda puede mandar: checkout.html?title=Coca+Cola&price=22&qty=2
(function preloadFromURL() {
  const p = new URLSearchParams(window.location.search);
  const title = p.get("title") || "";
  const price = parseFloat(p.get("price")) || 0;
  const qty   = parseInt(p.get("qty"))    || 1;

  if (title) getEl("product-title").value = sanitizeInput(title);
  if (price) getEl("product-price").value = price;
  if (qty)   getEl("product-qty").value   = qty;

  updateSummary();
})();

// ── HELPERS ──────────────────────────────────────────────────
function getEl(id) { return document.getElementById(id); }

// Sanitiza texto para evitar XSS en el frontend
function sanitizeInput(str) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML.trim().substring(0, 255);
}

function formatMXN(n) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN"
  }).format(n);
}

// ── RESUMEN EN TIEMPO REAL ───────────────────────────────────
function updateSummary() {
  const title = getEl("product-title").value || "—";
  const qty   = parseInt(getEl("product-qty").value)     || 0;
  const price = parseFloat(getEl("product-price").value) || 0;

  getEl("summary-title").textContent    = sanitizeInput(title);
  getEl("summary-qty").textContent      = qty;
  getEl("summary-subtotal").textContent = formatMXN(price);
  getEl("summary-total").textContent    = formatMXN(qty * price);
}

["product-title", "product-qty", "product-price"].forEach(id => {
  getEl(id).addEventListener("input", updateSummary);
});

// ── VALIDACIÓN ───────────────────────────────────────────────
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setError(inputId, errId, hasError) {
  getEl(inputId).classList.toggle("error", hasError);
  getEl(errId).classList.toggle("visible", hasError);
}

function validate() {
  const name  = getEl("payer-name").value.trim();
  const email = getEl("payer-email").value.trim();
  const title = getEl("product-title").value.trim();
  const qty   = parseInt(getEl("product-qty").value);
  const price = parseFloat(getEl("product-price").value);

  const checks = {
    name:  name.length >= 3 && name.length <= 100,
    email: EMAIL_REGEX.test(email) && email.length <= 150,
    title: title.length >= 2 && title.length <= 100,
    qty:   Number.isInteger(qty) && qty >= 1 && qty <= 999,
    price: !isNaN(price) && price > 0 && price <= 999999,
  };

  setError("payer-name",    "err-name",  !checks.name);
  setError("payer-email",   "err-email", !checks.email);
  setError("product-title", "err-title", !checks.title);
  setError("product-qty",   "err-qty",   !checks.qty);
  setError("product-price", "err-price", !checks.price);

  return Object.values(checks).every(Boolean);
}

// ── ALERTA GLOBAL ─────────────────────────────────────────────
function showAlert(msg) {
  const el = getEl("global-alert");
  el.textContent = msg;
  el.className = "alert error visible";
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideAlert() {
  getEl("global-alert").className = "alert error";
}

// ── ESTADO DEL BOTÓN ──────────────────────────────────────────
function setLoading(on) {
  getEl("btn-pay").disabled          = on;
  getEl("btn-text").textContent      = on ? "Procesando..." : "💳 Ir a pagar";
  getEl("spinner").style.display     = on ? "block" : "none";
}

// ── SUBMIT ────────────────────────────────────────────────────
getEl("checkout-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAlert();

  if (!validate()) return;

  setLoading(true);

  const payload = {
    title:       getEl("product-title").value.trim(),
    quantity:    parseInt(getEl("product-qty").value),
    unit_price:  parseFloat(getEl("product-price").value),
    payer_email: getEl("payer-email").value.trim(),
  };

  try {
    const res = await fetch(`${API_URL}/api/create-preference`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Error al procesar el pago.");
    }

    // Redirigir a MercadoPago (sandbox o producción según el modo)
    const redirectUrl = data.sandboxInitPoint || data.initPoint;
    window.location.href = redirectUrl;

  } catch (err) {
    showAlert("⚠️ " + (err.message || "Error de conexión. Intenta de nuevo."));
    setLoading(false);
  }
});
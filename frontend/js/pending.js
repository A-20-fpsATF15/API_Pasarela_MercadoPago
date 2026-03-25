"use strict";
const p = new URLSearchParams(window.location.search);
document.getElementById("payment-id").textContent   = p.get("payment_id")        || "—";
document.getElementById("external-ref").textContent = p.get("external_reference") || "—";




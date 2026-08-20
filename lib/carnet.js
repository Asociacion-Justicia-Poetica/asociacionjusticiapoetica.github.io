/**
 * Piezas compartidas del carnet de Poeta.
 *
 * El carnet no vive en ninguna base de datos: la verdad está en Stripe. Esta
 * capa solo sabe firmar y dibujar.
 */

import crypto from 'node:crypto';
import QRCode from 'qrcode';

export const SITIO = (process.env.SITIO_URL || 'https://asociacionjusticiapoetica-github-io.vercel.app').replace(/\/$/, '');

export const NIVELES = {
  prod_V6oHbbraK7OK2V: 'Poeta de la Justicia',
  prod_V6oHvL3BLmuxvz: 'Poeta Guerrero'
};

/**
 * Firma corta del identificador de cliente.
 *
 * Sin esto, la dirección del carnet sería `?c=cus_...` y cualquiera podría ir
 * probando identificadores para averiguar quién dona a la Asociación. Con la
 * firma, sin conocer el secreto no se puede construir una dirección válida.
 */
export function firma(id) {
  const secreto = process.env.CARNET_SECRET;
  if (!secreto) throw new Error('Falta CARNET_SECRET');
  return crypto.createHmac('sha256', secreto).update(String(id)).digest('hex').slice(0, 20);
}

export function firmaValida(id, s) {
  const esperada = firma(id);
  const a = Buffer.from(String(s || ''));
  const b = Buffer.from(esperada);
  // Comparación en tiempo constante: una comparación normal filtra información
  // por lo que tarda en fallar.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function urlCarnet(idCliente) {
  return `${SITIO}/api/carnet?c=${encodeURIComponent(idCliente)}&s=${firma(idCliente)}`;
}

export async function qrDataUri(texto) {
  return QRCode.toDataURL(texto, {
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 8,
    color: { dark: '#0c3c36', light: '#f2efe9' }
  });
}

export async function qrPng(texto) {
  return QRCode.toBuffer(texto, {
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 10,
    color: { dark: '#0c3c36', light: '#f2efe9' }
  });
}

function escapar(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Recorta el nombre para que no se salga de la tarjeta. */
function nombreAjustado(nombre) {
  const n = String(nombre || 'Poeta').trim();
  return n.length > 26 ? n.slice(0, 25).trim() + '…' : n;
}

/**
 * El carnet, en SVG. Mismo diseño que el ejemplo de la web, con los datos
 * de la persona y un código QR de verdad.
 */
export function carnetSvg({ nombre, nivel, numero, qr }) {
  const largo = nombreAjustado(nombre).length > 20;
  return `<svg class="carnet" viewBox="0 0 856 540" role="img" aria-label="Carnet de ${escapar(nivel)} a nombre de ${escapar(nombre)}" xmlns="http://www.w3.org/2000/svg">
  <rect width="856" height="540" rx="28" fill="#0c3c36"/>
  <rect x="1" y="1" width="854" height="538" rx="27" fill="none" stroke="#c69636" stroke-opacity=".45" stroke-width="2"/>
  <image href="${SITIO}/assets/img/emblema-blanco.png" x="56" y="52" width="52" height="91" preserveAspectRatio="xMidYMid meet"/>
  <text x="130" y="106" fill="#f2efe9" font-family="'Cormorant Garamond', Georgia, serif" font-size="34" letter-spacing="5.5">JUSTICIA POÉTICA</text>
  <text x="56" y="372" fill="#c69636" font-family="'Public Sans', sans-serif" font-size="21" font-weight="600" letter-spacing="4.2">${escapar(nivel).toUpperCase()}</text>
  <text x="56" y="432" fill="#f2efe9" font-family="'Cormorant Garamond', Georgia, serif" font-size="${largo ? 42 : 52}" font-weight="600">${escapar(nombreAjustado(nombre))}</text>
  <text x="56" y="474" fill="#b3c2be" font-family="'Public Sans', sans-serif" font-size="20">Socio n.º ${escapar(numero)}</text>
  <text x="56" y="504" fill="#b3c2be" font-family="'Public Sans', sans-serif" font-size="17">Válido presentando el DNI</text>
  <rect x="580" y="180" width="220" height="220" rx="14" fill="#f2efe9"/>
  <image href="${qr}" x="592" y="192" width="196" height="196"/>
</svg>`;
}

/** Página del carnet: la que se abre al escanear el código. */
export function paginaCarnet({ nombre, nivel, numero, qr, activo, motivo }) {
  const estado = activo
    ? `<p class="estado estado-ok"><strong>Carnet válido.</strong> La aportación está al corriente.</p>`
    : `<p class="estado estado-ko"><strong>Sin aportación activa.</strong> ${escapar(motivo || 'Este carnet no da derecho a las ventajas de Poeta.')}</p>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carnet de ${escapar(nivel)} | Asociación Justicia Poética</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="${SITIO}/assets/img/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="${SITIO}/assets/img/favicon-192.png">
<link rel="stylesheet" href="${SITIO}/assets/css/site.css">
<style>
  .estado { padding: .9rem 1.1rem; border-radius: var(--r-input); font-size: .98rem; margin: 1.5rem 0 0; }
  .estado-ok { background: var(--accent-wash); color: var(--accent-ink); }
  .estado-ko { background: var(--alert-wash); color: var(--alert); }
  .carnet { width: 100%; height: auto; display: block; border-radius: 14px; box-shadow: var(--shadow-lift); }
</style>
</head>
<body>
<main id="contenido">
  <section class="tight">
    <div class="wrap wrap-narrow">
      <h1 class="sr-only">Carnet de ${escapar(nivel)}</h1>
      ${carnetSvg({ nombre, nivel, numero, qr })}
      ${estado}
      <p class="small muted" style="margin-top:1.25rem">Esta página consulta el estado real de la aportación cada vez que se abre, así que siempre dice la verdad. Guárdala en la pantalla de inicio de tu móvil y llevarás el carnet encima.</p>
      <div class="btn-row" style="margin-top:1.5rem">
        <a class="btn btn-secondary" href="${SITIO}/poetas-guerreros.html">Ventajas del carnet</a>
        <a class="btn btn-secondary" href="https://billing.stripe.com/p/login/7sY7sKh1b9BT4gedaH4Ja00" rel="noopener">Gestionar mi aportación</a>
      </div>
    </div>
  </section>
</main>
</body>
</html>`;
}

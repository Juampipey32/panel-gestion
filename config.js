// Configuración pública del panel. NO lleva secretos:
// - SUPABASE_URL es la dirección pública del proyecto.
// - SUPABASE_KEY es la clave "publishable", pensada para ir en el navegador. Los datos están protegidos por
//   el login y por las reglas de seguridad por fila (RLS) de la base: sin un usuario autorizado no se ve nada.
// NUNCA poner acá la clave secreta ni la "service_role".
window.PANEL = {
  SUPABASE_URL: "https://bbgpekyaemvhprjydzcn.supabase.co",
  SUPABASE_KEY: "sb_publishable_wzjXVvgNHtiLcATj7ZfOng_C3VZtvlF",
};

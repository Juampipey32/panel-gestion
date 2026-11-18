# Panel de gestión

Front estático (HTML + JS, sin compilación) sobre Supabase: liquidación semanal, partes, cotizaciones con PDF, adelantos y memoria buscable.

## Cómo está armado
- **Datos y cálculo:** viven en Supabase (Postgres). Las cuentas, los importes y los cierres de semana los calcula la base con funciones SQL; el panel solo muestra resultados.
- **Seguridad:** login por link al email (sin contraseñas, registro público desactivado) + reglas de seguridad por fila (RLS). Sin un usuario cargado en la tabla `acceso` no se ve ni se escribe nada.
- **PDF:** los genera la Edge Function `pdf` con la sesión del usuario y los guarda en un bucket privado (link firmado de 1 hora).
- **Este repo no tiene datos ni secretos.** `config.js` lleva solo la dirección pública del proyecto y la clave *publishable*, pensada para el navegador.

## Publicación (GitHub Pages)
Se publica la rama `main`, carpeta raíz. Cada cambio en `main` se redespliega solo.

### Dominio propio
1. En el DNS del dominio, un registro `CNAME` del subdominio hacia `<usuario>.github.io`.
2. Agregar un archivo `CNAME` en la raíz del repo con el subdominio, o cargarlo en Settings → Pages → Custom domain.
3. Activar *Enforce HTTPS* cuando GitHub emita el certificado.
4. En Supabase → Authentication → URL Configuration: poner el dominio como *Site URL* y agregarlo a *Redirect URLs*.

### Configuración de Supabase que necesita
- Authentication → *Allow new users to sign up*: **desactivado**.
- Authentication → Users → *Invite user*, y luego autorizar el usuario: `insert into public.acceso (user_id, nombre) values ('<uuid>', '<nombre>');`

## Desarrollo local
Abrir `index.html` con cualquier servidor estático (por ejemplo `python -m http.server`). Para el login por link hay que agregar la dirección local a *Redirect URLs* de Supabase.

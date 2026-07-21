# Amara — tu asistente personal

Proyecto Vite + React, listo para subir a GitHub y desplegar en Vercel.

## 1. Subir a GitHub

Dentro de esta carpeta:

```
git init
git add .
git commit -m "Amara"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/amara.git
git push -u origin main
```

(Si ya tenías un repo con el `.jsx` suelto, borra esos archivos viejos primero y sube esta carpeta completa en su lugar — el build fallaba porque a ese repo le faltaban `package.json`, `index.html`, etc.)

## 2. Importar en Vercel

1. Entra a vercel.com → **Add New → Project** → selecciona el repo `amara`.
2. Vercel detecta Vite automáticamente. No cambies nada del build command / output directory.
3. Antes de darle "Deploy", ve a **Environment Variables** y agrega:
   - `ANTHROPIC_API_KEY` = tu llave de la consola de Anthropic (console.anthropic.com → API Keys).

Sin esa llave, la app carga bien pero Amara (el chat, el resumen matutino, el dictado) no podrá responder — el resto (calendario, pendientes, diario, contactos) funciona igual porque se guarda en el navegador.

## 3. Cambia el dominio en los metadatos

En `index.html`, reemplaza `TU-DOMINIO.vercel.app` por el dominio real que Vercel te asigne (las dos líneas `og:image` y `og:url`), para que la vista previa del link funcione al compartirlo. Vuelve a hacer commit + push después de este cambio.

## Nota sobre privacidad y guardado

Fuera de Claude.ai, esta versión guarda los datos de cada persona en el **localStorage de su propio navegador** (no en un servidor), porque `window.storage` de Claude no existe fuera de ahí. Esto significa:
- Cada dispositivo/navegador tiene su propia copia — no se sincroniza entre tu celular y tu laptop todavía.
- Es privado en el sentido de que nadie más puede leerlo sin acceso físico a ese navegador, pero no hay una cuenta "en la nube" real detrás.

Si más adelante quieres que la información sí viaje entre dispositivos (y sea de verdad multiusuario con una base de datos), el siguiente paso sería conectar algo como Vercel KV, Postgres o Supabase — puedo ayudarte a montarlo cuando quieras.

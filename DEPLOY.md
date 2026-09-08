# Deploy

## GitHub

1. Crear un repositorio nuevo.
2. Subir esta carpeta como raiz del repo.
3. No subir `.env.local`.

## Vercel

1. Importar el repo desde Vercel.
2. Framework: Next.js.
3. Build command: `npm run build`.
4. Install command: `npm install`.
5. Output: `.next`.
6. Activar deploy automatico desde la rama `main`.
7. Agregar variables cuando conectemos Supabase:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

La primera version no necesita variables de entorno para desplegar.

## Supabase

1. Crear proyecto Supabase Cloud.
2. Ejecutar `supabase/schema.sql`.
3. En la siguiente etapa agregamos policies RLS completas y conectamos la app.

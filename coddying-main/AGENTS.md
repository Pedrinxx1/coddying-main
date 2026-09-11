<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Build & Lint

- **Typecheck:** `npx tsc --noEmit` (or `bun run tsc --noEmit`)
- **Lint:** `npm run lint` (or `bun run lint`)
- **Build:** `npm run build` (or `bun run build`)

## Environment Variables

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — Client-side Supabase config
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` — Server-side Supabase config
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase admin (server-side only, `src/integrations/supabase/client.server.ts`)
- `GEMINI_API_KEY` — Gemini API key for AI tutor (server-side only)
- `ANTHROPIC_API_KEY` — Claude API key for AI tutor (server-side only, tried first)

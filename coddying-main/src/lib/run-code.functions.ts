import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const JUDGE0 = "https://ce.judge0.com";
const PISTON = "https://emkc.org/api/v2/piston/execute";

const schema = z.object({
  language: z.string().min(1),
  code: z.string(),
  stdin: z.string().optional(),
});

export type RunResult = {
  ok: boolean;
  output: string;
  stderr?: string;
  error?: string;
  status?: string;
  time?: string | null;
};

type Lang = { id: number; name: string };

let cache: { at: number; list: Lang[] } | null = null;

async function getLanguages(): Promise<Lang[]> {
  if (cache && Date.now() - cache.at < 30 * 60 * 1000) return cache.list;
  try {
    const res = await fetch(`${JUDGE0}/languages`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return cache?.list ?? [];
    const list = (await res.json()) as Lang[];
    cache = { at: Date.now(), list };
    return list;
  } catch {
    return cache?.list ?? [];
  }
}

const aliases: Record<string, string> = {
  js: "javascript",
  node: "javascript",
  "node.js": "javascript",
  ts: "typescript",
  py: "python",
  py3: "python",
  python3: "python",
  cpp: "c++",
  "c#": "c#",
  cs: "c#",
  csharp: "c#",
  sh: "bash",
  shell: "bash",
  golang: "go",
  sqlite: "sql",
  sqlite3: "sql",
  kt: "kotlin",
  rb: "ruby",
  rs: "rust",
  pl: "perl",
  hs: "haskell",
  ex: "elixir",
  "objective-c": "objective-c",
  java: "java",
  swift: "swift",
  dart: "dart",
  scala: "scala",
  r: "r",
  lua: "lua",
  php: "php",
};

const PISTON_PRIMARY: Set<string> = new Set([
  "java", "python", "javascript", "typescript",
  "c++", "c", "c#", "sql", "bash",
  "swift", "dart", "scala", "r", "lua",
]);

const pistonRuntime: Record<string, { language: string; version: string }> = {
  java: { language: "java", version: "15.0.2" },
  python: { language: "python", version: "3.10.0" },
  javascript: { language: "javascript", version: "18.15.0" },
  typescript: { language: "typescript", version: "5.0.3" },
  "c++": { language: "c++", version: "10.2.0" },
  c: { language: "c", version: "10.2.0" },
  "c#": { language: "csharp", version: "6.12.0" },
  go: { language: "go", version: "1.16.2" },
  rust: { language: "rust", version: "1.50.0" },
  ruby: { language: "ruby", version: "3.0.1" },
  kotlin: { language: "kotlin", version: "1.8.20" },
  php: { language: "php", version: "8.2.3" },
  swift: { language: "swift", version: "5.3.3" },
  dart: { language: "dart", version: "2.19.6" },
  scala: { language: "scala", version: "3.2.2" },
  r: { language: "r", version: "4.1.1" },
  lua: { language: "lua", version: "5.4.4" },
  sql: { language: "sqlite3", version: "3.39.0" },
  bash: { language: "bash", version: "5.2.0" },
  haskell: { language: "haskell", version: "9.0.1" },
  elixir: { language: "elixir", version: "1.11.3" },
  perl: { language: "perl", version: "5.36.0" },
};

function resolveLanguage(input: string, list: Lang[]) {
  const raw = input.trim().toLowerCase();
  const q = aliases[raw] ?? raw;
  const matches = list.filter((l) => {
    const base = l.name.toLowerCase().split("(")[0]!.trim();
    return base === q;
  });
  const fallback = list.filter((l) => l.name.toLowerCase().includes(q));
  const pool = matches.length ? matches : fallback;
  if (!pool.length) return undefined;
  return pool.reduce((a, b) => (b.id > a.id ? b : a));
}

function splitJavaImports(code: string): { imports: string[]; body: string } {
  const lines = code.split("\n");
  const imports: string[] = [];
  const rest: string[] = [];
  let seenNonImport = false;
  for (const line of lines) {
    if (!seenNonImport && /^\s*import\s+/.test(line)) {
      imports.push(line);
    } else {
      seenNonImport = true;
      rest.push(line);
    }
  }
  return { imports, body: rest.join("\n").trim() };
}

/**
 * Wrap Java code to ensure it can be compiled and run.
 * Handles: complete class, imports + main, imports + body, loose main, and plain statements.
 * Always places imports before the class declaration.
 */
function wrapJavaCode(code: string): string {
  const trimmed = code.trim();

  if (!trimmed) return "public class Main {\n  public static void main(String[] args) {\n  }\n}";

  if (/\bpublic\s+class\s+\w+/.test(trimmed)) {
    return trimmed;
  }

  if (/^\s*class\s+\w+/.test(trimmed)) {
    return trimmed;
  }

  const { imports, body } = splitJavaImports(trimmed);

  if (!body) {
    return [
      ...imports,
      "public class Main {",
      "  public static void main(String[] args) {",
      "  }",
      "}",
    ].join("\n");
  }

  if (/public\s+static\s+void\s+main\s*\(/.test(body)) {
    return [
      ...imports,
      "public class Main {",
      ...body.split("\n").map((l) => `  ${l}`),
      "}",
    ].join("\n");
  }

  const hasMethods = /\b(public|private|protected|static)\s+\w+\s+\w+\s*\(/.test(body);

  if (hasMethods) {
    return [
      ...imports,
      "public class Main {",
      ...body.split("\n").map((l) => `  ${l}`),
      "}",
    ].join("\n");
  }

  return [
    ...imports,
    "public class Main {",
    "  public static void main(String[] args) {",
    ...body.split("\n").map((l) => `    ${l}`),
    "  }",
    "}",
  ].join("\n");
}

async function runViaPiston(
  normalizedLang: string,
  code: string,
  stdin: string,
): Promise<RunResult> {
  const runtime = pistonRuntime[normalizedLang];
  if (!runtime) {
    return {
      ok: false,
      output: "",
      error: `Linguagem "${normalizedLang}" não disponível na Piston API.`,
    };
  }

  const finalCode =
    normalizedLang === "java" ? wrapJavaCode(code) : code;

  const filename =
    normalizedLang === "java" ? "Main.java" :
    normalizedLang === "c++" ? "main.cpp" :
    normalizedLang === "c" ? "main.c" :
    normalizedLang === "c#" ? "Program.cs" :
    normalizedLang === "typescript" ? "index.ts" :
    normalizedLang === "sql" ? "query.sql" :
    `main.${normalizedLang}`;

  try {
    const res = await fetch(PISTON, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: runtime.language,
        version: runtime.version,
        files: [{ name: filename, content: finalCode }],
        stdin,
        run_timeout: 10000,
        compile_timeout: 10000,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, output: "", error: `Piston: ${text.slice(0, 300)}` };
    }

    const body = (await res.json()) as {
      run?: { stdout: string; stderr: string; code: number; signal?: string };
      compile?: { stdout: string; stderr: string; code: number };
      message?: string;
    };

    if (body.message) {
      return { ok: false, output: "", error: body.message };
    }

    const compileErr = body.compile?.stderr ?? "";
    const compileOut = body.compile?.stdout ?? "";
    const runOut = body.run?.stdout ?? "";
    const runErr = body.run?.stderr ?? "";
    const exitCode = body.run?.code ?? 0;
    const timedOut = body.run?.signal === "SIGTERM";

    if (compileErr && !runOut) {
      return {
        ok: false,
        output: compileOut,
        stderr: compileErr,
        status: `Piston • ${runtime.language} ${runtime.version}`,
      };
    }

    const combined = [compileOut, runOut].filter(Boolean).join("\n").trim();
    const stderr = [compileErr, runErr].filter(Boolean).join("\n").trim();

    return {
      ok: !timedOut && exitCode === 0,
      output: combined || (timedOut ? "Tempo esgotado — seu código pode estar esperando entrada (stdin) que não foi fornecida." : stderr ? "" : "(sem saída)"),
      error: timedOut ? "Tempo esgotado: o código pode estar esperando entrada que não foi fornecida." : undefined,
      stderr,
      status: `Piston • ${runtime.language} ${runtime.version}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha na conexão com Piston API";
    const isTimeout = msg.includes("timeout") || msg.includes("aborted") || msg.includes("AbortError");
    return {
      ok: false,
      output: isTimeout ? "Tempo esgotado — seu código pode estar esperando entrada (stdin) que não foi fornecida." : "",
      error: isTimeout ? "Tempo esgotado: o código pode estar esperando entrada que não foi fornecida." : msg,
    };
  }
}

async function runViaJudge0(
  normalizedLang: string,
  code: string,
  stdin: string,
): Promise<RunResult> {
  const list = await getLanguages();
  const lang = resolveLanguage(normalizedLang, list);

  if (!lang) {
    throw new Error(
      `Linguagem "${normalizedLang}" não disponível no Judge0. Tentando Piston...`,
    );
  }

  const enc = (s: string) => Buffer.from(s, "utf-8").toString("base64");
  const dec = (s?: string | null) =>
    s ? Buffer.from(s, "base64").toString("utf-8") : "";

  const isJava = lang.name.toLowerCase().includes("java");
  const finalCode = isJava ? wrapJavaCode(code) : code;
  const cpuLimit = isJava ? 10 : 5;

  const res = await fetch(`${JUDGE0}/submissions?base64_encoded=true&wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      language_id: lang.id,
      source_code: enc(finalCode),
      stdin: enc(stdin),
      cpu_time_limit: cpuLimit,
      wall_time_limit: cpuLimit + 5,
    }),
    signal: AbortSignal.timeout(15000),
  });

  const text = await res.text();
  if (!res.ok) {
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`Judge0 ${res.status}`);
    }
    return { ok: false, output: "", error: text.slice(0, 500) };
  }

  const body = JSON.parse(text) as {
    stdout?: string | null;
    stderr?: string | null;
    compile_output?: string | null;
    message?: string | null;
    time?: string | null;
    status?: { id: number; description: string };
  };

  const out = [dec(body.compile_output), dec(body.stdout)].filter(Boolean).join("\n").trim();
  const err = [dec(body.stderr), dec(body.message)].filter(Boolean).join("\n").trim();

  return {
    ok: body.status?.id === 3,
    output: out || (err ? "" : "(sem saída)"),
    stderr: err,
    status: `${lang.name} • ${body.status?.description ?? ""}`,
    time: body.time ?? null,
  };
}

function shouldFallback(result: RunResult): boolean {
  if (result.ok || result.stderr || result.output) return false;
  if (result.error?.includes("Tempo esgotado")) return false;
  return true;
}

export const runCode = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }): Promise<RunResult> => {
    const raw = data.language.trim().toLowerCase();
    const normalized = aliases[raw] ?? raw;
    const stdin = data.stdin ?? "";

    if (PISTON_PRIMARY.has(normalized)) {
      const pistonResult = await runViaPiston(normalized, data.code, stdin);
      if (!shouldFallback(pistonResult)) return pistonResult;
      try {
        const judge0Result = await runViaJudge0(normalized, data.code, stdin);
        if (!shouldFallback(judge0Result)) return judge0Result;
      } catch {
        /* Judge0 also failed — return Piston error */
      }
      return pistonResult;
    }

    try {
      const judge0Result = await runViaJudge0(normalized, data.code, stdin);
      if (!shouldFallback(judge0Result)) return judge0Result;
      throw new Error("Judge0 returned no output");
    } catch {
      const pistonResult = await runViaPiston(normalized, data.code, stdin);
      if (pistonResult.error?.includes("não disponível na Piston")) {
        return {
          ok: false,
          output: "",
          error: `Não foi possível executar "${normalized}". Verifique sua conexão e tente novamente.`,
        };
      }
      return pistonResult;
    }
  });

export const listRuntimes = createServerFn({ method: "GET" }).handler(async () => {
  const list = await getLanguages();
  const judge0Names = list.map((l) => l.name);
  const pistonNames = Object.keys(pistonRuntime);
  return [...new Set([...judge0Names, ...pistonNames])].sort();
});

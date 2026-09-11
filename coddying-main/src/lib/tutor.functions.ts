import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GEMINI_API_KEY = process.env["GOOGLE_GENERATIVE_API_KEY"] ?? process.env["GEMINI_API_KEY"];
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

const CLAUDE_API_KEY = process.env["ANTHROPIC_API_KEY"];
const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-3-5-sonnet-20241022";

const schema = z.object({
  prompt: z.string(),
  context: z.string(),
});

export type TutorServerResult = {
  text: string;
  ok: boolean;
};

const SYSTEM_PROMPT =
  `Você é um tutor de programação paciente e didático. Responda apenas com base no material da lição fornecido. ` +
  `Se a informação não estiver no material, diga que não pode responder. ` +
  `Mantenha a resposta concisa, em português, com no máximo 4 parágrafos.`;

export const askGemini = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }): Promise<TutorServerResult> => {
    if (!GEMINI_API_KEY) {
      return { text: "", ok: false };
    }

    const userPrompt = `Material da lição:\n${data.context}\n\nPergunta do aluno:\n${data.prompt}`;

    try {
      const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1024,
          },
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        return { text: "", ok: false };
      }

      const body = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        error?: { message: string };
      };

      if (body.error) {
        return { text: "", ok: false };
      }

      const text = body.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
      return { text, ok: !!text };
    } catch {
      return { text: "", ok: false };
    }
  });

export const askClaude = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }): Promise<TutorServerResult> => {
    if (!CLAUDE_API_KEY) {
      return { text: "", ok: false };
    }

    const userPrompt = `Material da lição:\n${data.context}\n\nPergunta do aluno:\n${data.prompt}`;

    try {
      const res = await fetch(CLAUDE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": CLAUDE_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          temperature: 0.3,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        return { text: "", ok: false };
      }

      const body = (await res.json()) as {
        content?: Array<{ type: string; text?: string }>;
        error?: { message: string };
      };

      if (body.error) {
        return { text: "", ok: false };
      }

      const text = body.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
      return { text, ok: !!text };
    } catch {
      return { text: "", ok: false };
    }
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GEMINI_API_KEY = process.env["GOOGLE_GENERATIVE_API_KEY"] ?? process.env["GEMINI_API_KEY"];
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

const schema = z.object({
  prompt: z.string(),
  context: z.string(),
});

export type TutorServerResult = {
  text: string;
  ok: boolean;
};

export const askGemini = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }): Promise<TutorServerResult> => {
    if (!GEMINI_API_KEY) {
      return { text: "", ok: false };
    }

    const systemPrompt = `Você é um tutor de programação paciente e didático. Responda apenas com base no material da lição fornecido. Se a informação não estiver no material, diga que não pode responder. Mantenha a resposta concisa, em português, com no máximo 4 parágrafos.`;

    const userPrompt = `Material da lição:\n${data.context}\n\nPergunta do aluno:\n${data.prompt}`;

    try {
      const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
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

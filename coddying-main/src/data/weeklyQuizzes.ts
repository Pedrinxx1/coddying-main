import type { Course } from "./courses";
import type { QuizQuestion } from "./lessonLibrary";
import { findTopic } from "./lessonLibrary";
import { finalExam } from "./finalAssessments";

export const WEEKLY_QUIZ_SIZE = 8;

export type QuizResult = {
  score: number;
  total: number;
  percent: number;
  passed: boolean;
  adaptive: boolean;
  harder: boolean;
  easier: boolean;
};

export type WeeklyAttempt = {
  id: string;
  course_slug: string;
  score: number;
  total: number;
  percent: number;
  passed: boolean;
  created_at: string;
};

/**
 * Gera um quiz adaptativo a partir das lições que o usuário já completou.
 *
 * Estratégia de adaptive:
 * 1. Coleta todas as questões de quiz dos tópicos das lições concluídas.
 * 2. Divide em "recentes" (últimas lições do curso) e "fundamentais" (lições iniciais).
 * 3. Sempre inclui 4-5 questões de nível médio (recentes + fundamentais).
 * 4. Se o usuário tem histórico de acertos altos → adiciona questões mais avançadas (módulos posteriores).
 * 5. Se o usuário tem acertos baixos → reforça com questões mais básicas.
 */
export function generateWeeklyQuiz(
  course: Course,
  completedLessons: { module_index: number; lesson_index: number }[],
  history: WeeklyAttempt[] = [],
): { questions: QuizQuestion[]; adaptive: boolean; harder: boolean; easier: boolean } {
  const seen = new Set<string>();
  const byModule: Record<number, QuizQuestion[]> = {};

  for (const lp of completedLessons) {
    const mod = course.modules[lp.module_index];
    if (!mod) continue;
    const lesson = mod.lessons[lp.lesson_index];
    if (!lesson) continue;
    const topic = findTopic(lesson, mod.title, course.lang, course.slug);
    const filtered = topic.quiz.filter((q) => {
      if (seen.has(q.q)) return false;
      seen.add(q.q);
      // Evita questões de outras linguagens que coincidem por título
      const texto = `${q.q} ${q.options.join(" ")}`.toLowerCase();
      const permitidas = languageList(course.lang);
      const outras = ["python", "javascript", "typescript", "java", "sql", "html", "css"].filter(
        (n) => !permitidas.includes(n),
      );
      if (outras.some((n) => texto.includes(` ${n}`) || texto.includes(`em ${n}`))) return false;
      return true;
    });

    if (filtered.length > 0) {
      if (!byModule[lp.module_index]) byModule[lp.module_index] = [];
      byModule[lp.module_index].push(...filtered);
    }
  }

  const moduleIndexes = Object.keys(byModule)
    .map(Number)
    .sort((a, b) => a - b);

  if (moduleIndexes.length === 0) {
    // Fallback: usar questões do exame final
    const fallback = generateFallback(course);
    return {
      questions: fallback.slice(0, WEEKLY_QUIZ_SIZE),
      adaptive: false,
      harder: false,
      easier: false,
    };
  }

  const maxModule = Math.max(...moduleIndexes);

  // Questões mais recentes (último módulo com conteúdo)
  const recentes = byModule[maxModule] ?? [];

  // Questões fundamentais (primeiro módulo)
  const fundamentais = byModule[0] ?? byModule[moduleIndexes[0]!] ?? [];

  // Questões intermediárias
  const intermediarios: QuizQuestion[] = [];
  for (const idx of moduleIndexes) {
    if (idx !== 0 && idx !== maxModule) {
      intermediarios.push(...(byModule[idx] ?? []));
    }
  }

  const harder = averageRecentScore(history) >= 0.8;
  const easier = averageRecentScore(history) < 0.5 && history.length > 0;

  const selected: QuizQuestion[] = [];
  const takeN = (arr: QuizQuestion[], n: number) => {
    const shuffled = [...arr].sort(() => Math.random() - 0.5);
    for (let i = 0; i < n && shuffled[i]; i++) {
      if (selected.length >= WEEKLY_QUIZ_SIZE) break;
      selected.push(shuffled[i]!);
    }
  };

  // 1. Sempre inclui questões recentes (nivel médio)
  takeN(recentes, 4);
  // 2. Sempre inclui questões fundamentais
  takeN(fundamentais, 2);
  // 3. Questões intermediárias
  takeN(intermediarios, 2);

  // 4. Adapta: se acertos altos, adiciona questões de módulos mais avançados
  if (harder && selected.length < WEEKLY_QUIZ_SIZE) {
    // Coleta questões de tópicos que ainda não estão no pool, priorizando módulos futuros
    const extra = collectFutureQuestions(course, completedLessons, seen);
    takeN(extra, WEEKLY_QUIZ_SIZE - selected.length);
  }

  // 5. Adapta: se acertos baixos, reforça com fundamentais
  if (easier && selected.length < WEEKLY_QUIZ_SIZE) {
    takeN(fundamentais, WEEKLY_QUIZ_SIZE - selected.length);
  }

  // 6. Se ainda falta, preenche com o pool geral
  const allPool = [...recentes, ...fundamentais, ...intermediarios];
  takeN(allPool, WEEKLY_QUIZ_SIZE - selected.length);

  return {
    questions: selected,
    adaptive: harder || easier,
    harder,
    easier,
  };
}

function averageRecentScore(history: WeeklyAttempt[]): number {
  if (history.length === 0) return 0;
  const recent = history.slice(0, 3);
  const total = recent.reduce((s, a) => s + a.score, 0);
  const qs = recent.reduce((s, a) => s + a.total, 0);
  return qs > 0 ? total / qs : 0;
}

function languageList(lang: string): string[] {
  const map: Record<string, string[]> = {
    python: ["python"],
    javascript: ["javascript", "js", "node"],
    typescript: ["typescript", "javascript", "js"],
    java: ["java"],
    html: ["html", "css"],
    css: ["css", "html"],
    sql: ["sql"],
    bash: ["bash", "shell", "docker", "git"],
  };
  return map[lang] ?? [lang];
}

function generateFallback(course: Course): QuizQuestion[] {
  return finalExam(course);
}

function collectFutureQuestions(
  course: Course,
  completed: { module_index: number; lesson_index: number }[],
  seen: Set<string>,
): QuizQuestion[] {
  const completedKeys = new Set(completed.map((lp) => `${lp.module_index}-${lp.lesson_index}`));
  const result: QuizQuestion[] = [];

  for (let mi = 0; mi < course.modules.length; mi++) {
    const mod = course.modules[mi];
    if (!mod) continue;
    for (let li = 0; li < mod.lessons.length; li++) {
      const lesson = mod.lessons[li];
      if (!lesson) continue;
      if (completedKeys.has(`${mi}-${li}`)) continue; // pula concluídas
      const topic = findTopic(lesson, mod.title, course.lang, course.slug);
      for (const q of topic.quiz) {
        if (!seen.has(q.q)) {
          seen.add(q.q);
          result.push(q);
        }
        if (result.length >= WEEKLY_QUIZ_SIZE) return result;
      }
    }
  }
  return result;
}

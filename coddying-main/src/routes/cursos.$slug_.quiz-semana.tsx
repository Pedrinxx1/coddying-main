import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Calendar, ChevronLeft, CheckCircle2, XCircle } from "lucide-react";
import { getCourse } from "@/data/courses";
import { generateWeeklyQuiz, type WeeklyAttempt } from "@/data/weeklyQuizzes";
import { SiteHeader } from "@/components/SiteHeader";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/cursos/$slug_/quiz-semana")({
  loader: ({ params }) => {
    const course = getCourse(params.slug);
    if (!course) throw notFound();
    return { course };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Quiz semanal | Codding" }] };
    const c = loaderData.course;
    const title = `Quiz semanal de ${c.title} | Codding`;
    return {
      meta: [
        { title },
        { name: "description", content: `Quiz adaptativo de ${c.title} baseado no seu progresso.` },
        { property: "og:title", content: title },
        { property: "og:description", content: `Quiz adaptativo de ${c.title} baseado no seu progresso.` },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: WeeklyQuizPage,
  notFoundComponent: () => (
    <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
      <div>
        <h1 className="font-display text-3xl font-extrabold">Curso não encontrado</h1>
        <Link to="/cursos" className="bg-brand mt-6 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 font-bold text-primary-foreground">
          Ver cursos
        </Link>
      </div>
    </div>
  ),
});

type LessonProgressRow = { module_index: number; lesson_index: number; completed_at: string };

function WeeklyQuizPage() {
  const { course } = Route.useLoaderData();
  const { user } = useSession();
  const [progress, setProgress] = useState<LessonProgressRow[]>([]);
  const [history, setHistory] = useState<WeeklyAttempt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setProgress([]);
      setHistory([]);
      setLoading(false);
      return;
    }
    void (async () => {
      const { data: prog } = await supabase
        .from("lesson_progress")
        .select("module_index, lesson_index, completed_at")
        .eq("course_slug", course.slug);

      setProgress((prog ?? []) as LessonProgressRow[]);

      const stored = localStorage.getItem(`codding:quiz:${course.slug}`);
      let hist: WeeklyAttempt[] = [];
      if (stored) {
        try {
          hist = JSON.parse(stored) as WeeklyAttempt[];
        } catch {
          /* ignore invalid */
        }
      }
      setHistory(hist);
      setLoading(false);
    })();
  }, [user, course.slug]);

  const completedLessons = useMemo(
    () => progress.map((p) => ({ module_index: p.module_index, lesson_index: p.lesson_index })),
    [progress],
  );

  const quiz = useMemo(
    () => generateWeeklyQuiz(course, completedLessons, history),
    [course, completedLessons, history],
  );

  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [result, setResult] = useState<{ score: number; total: number } | null>(null);

  const respondidas = Object.keys(answers).length;
  const podeEnviar = respondidas === quiz.questions.length;

  function submit() {
    if (!podeEnviar) return;
    const score = quiz.questions.reduce((n, q, i) => n + (answers[i] === q.answer ? 1 : 0), 0);
    const total = quiz.questions.length;
    setResult({ score, total });
    setChecked(
      quiz.questions.reduce(
        (acc, q, i) => ({ ...acc, [i]: answers[i] === q.answer }),
        {} as Record<number, boolean>,
      ),
    );

    const attempt: WeeklyAttempt = {
      id: `${Date.now()}`,
      course_slug: course.slug,
      score,
      total,
      percent: Math.round((score / total) * 100),
      passed: score / total >= 0.7,
      created_at: new Date().toISOString(),
    };
    const key = `codding:quiz:${course.slug}`;
    const stored = localStorage.getItem(key);
    let hist: WeeklyAttempt[] = [];
    if (stored) {
      try {
        hist = JSON.parse(stored) as WeeklyAttempt[];
      } catch {
        /* ignore */
      }
    }
    hist = [attempt, ...hist].slice(0, 20);
    localStorage.setItem(key, JSON.stringify(hist));
    setHistory(hist);
  }

  function reset() {
    setAnswers({});
    setChecked({});
    setResult(null);
  }

  if (loading) {
    return (
      <div className="min-h-dvh bg-background">
        <SiteHeader crumb="Quiz semanal" />
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-3/4 rounded bg-surface-2" />
            <div className="h-4 w-1/2 rounded bg-surface-2" />
            <div className="h-64 rounded-xl bg-surface-2" />
          </div>
        </main>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-dvh bg-background">
        <SiteHeader crumb="Quiz semanal" />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 text-center">
          <div className="mx-auto max-w-md">
            <Calendar className="mx-auto h-12 w-12 text-cyan" />
            <h1 className="mt-4 font-display text-3xl font-extrabold">Quiz semanal adaptativo</h1>
            <p className="mt-4 text-sm text-muted-foreground">
              O quiz semanal adapta-se ao seu progresso: perguntas vêm das lições que você já concluiu,
              e a dificuldade ajusta automaticamente nos próximos envios.
            </p>
            <Link
              to="/entrar"
              className="bg-brand mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 font-bold text-primary-foreground"
            >
              Entrar para fazer o quiz
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const completedCount = completedLessons.length;
  const totalLessons = course.modules.reduce((acc, m) => acc + m.lessons.length, 0);

  if (completedCount === 0) {
    return (
      <div className="min-h-dvh bg-background">
        <SiteHeader crumb="Quiz semanal" />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 text-center">
          <Calendar className="mx-auto h-12 w-12 text-muted-foreground" />
          <h1 className="mt-4 font-display text-2xl font-extrabold">Quiz semanal adaptativo</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Complete algumas lições de <strong>{course.title}</strong> para desbloquear o quiz da semana.
          </p>
          <Link
            to="/cursos/$slug"
            params={{ slug: course.slug }}
            className="bg-brand mt-6 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 font-bold text-primary-foreground"
          >
            Estudar {course.title}
          </Link>
        </main>
      </div>
    );
  }

  const passed = result && result.score / result.total >= 0.7;

  return (
    <div className="min-h-dvh bg-background">
      <SiteHeader crumb="Quiz semanal" />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Link
          to="/cursos/$slug"
          params={{ slug: course.slug }}
          className="inline-flex items-center gap-1 text-sm font-semibold text-cyan hover:text-cyan/80"
        >
          <ChevronLeft className="h-4 w-4" /> {course.title}
        </Link>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <h1 className="font-display text-3xl font-extrabold sm:text-4xl">Quiz semanal adaptativo</h1>
          {quiz.adaptive && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
                quiz.harder
                  ? "border border-blue/30 bg-blue/10 text-blue"
                  : quiz.easier
                    ? "border border-amber/30 bg-amber/10 text-amber"
                    : "border border-cyan/30 bg-cyan/10 text-cyan"
              }`}
            >
              {quiz.harder ? "Mais difícil" : quiz.easier ? "Revisão reforçada" : "Nível médio"}
            </span>
          )}
        </div>

        <p className="mt-3 text-sm text-muted-foreground">
          {completedCount} de {totalLessons} lições concluídas • {quiz.questions.length} questões •
          Baseado no seu progresso em {course.title}
        </p>

        {!result && (
          <p aria-live="polite" className="mt-1 text-sm text-muted-foreground">
            {respondidas} de {quiz.questions.length} questões respondidas
          </p>
        )}

        <section aria-labelledby="quiz-titulo" className="mt-8">
          <h2 id="quiz-titulo" className="font-display text-xl font-bold">
            Questões
          </h2>
          <ol className="mt-6 space-y-6">
            {quiz.questions.map((q, i) => {
              const escolha = answers[i];
              const mostrar = checked[i];
              const acertou = escolha === q.answer;
              return (
                <li key={q.q} className="card-soft p-4 sm:p-5">
                  <p className="font-display font-bold leading-snug">
                    {i + 1}. {q.q}
                  </p>
                  <div
                    role="radiogroup"
                    aria-label={`Questão ${i + 1}`}
                    className="mt-3 grid gap-2"
                  >
                    {q.options.map((opt, oi) => (
                      <button
                        key={opt}
                        role="radio"
                        aria-checked={escolha === oi}
                        disabled={mostrar}
                        onClick={() => setAnswers((a) => ({ ...a, [i]: oi }))}
                        className={`min-h-11 rounded-xl border px-4 py-2.5 text-left text-sm leading-6 ${
                          mostrar && oi === q.answer
                            ? "border-success text-success"
                            : escolha === oi
                              ? "border-cyan text-foreground"
                              : "border-border text-muted-foreground hover:border-cyan/60"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                  {mostrar && (
                    <p
                      aria-live="polite"
                      className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${
                        acertou
                          ? "border-success/50 text-success"
                          : "border-warn/50 text-warn"
                      }`}
                    >
                      {acertou ? "Acertou. " : `Correto: ${q.options[q.answer]}. `}
                      <span className="text-muted-foreground">{q.why}</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        {result && (
          <div
            aria-live="polite"
            className={`mt-8 rounded-xl border px-5 py-4 text-center ${
              passed
                ? "border-success/60 bg-success/5 text-success"
                : "border-warn/60 bg-warn/5 text-warn"
            }`}
          >
            <h3 className="font-display text-xl font-bold">
              {passed ? "Aprovado!" : "Quase lá!"}
            </h3>
            <p className="mt-1 text-sm">
              Você acertou {result.score} de {result.total} questões.
              {history.length > 0 && ` Sua média recente: ${Math.round(
                (history.slice(0, 3).reduce((s, a) => s + a.score, 0) /
                  history.slice(0, 3).reduce((s, a) => s + a.total, 0)) *
                  100,
              )}%`}
            </p>
            {quiz.adaptive && (
              <p className="mt-2 text-xs">
                {quiz.harder
                  ? "Acertos altos: o próximo quiz trará questões mais avançadas."
                  : quiz.easier
                    ? "Revisão reforçada: o próximo quiz reforçará os fundamentos."
                    : "Continue praticando para desbloquear a adaptação automática."}
              </p>
            )}
          </div>
        )}

        <div className="mt-8 flex flex-wrap gap-3">
          {!result && (
            <button
              onClick={() => void submit()}
              disabled={!podeEnviar}
              className="bg-brand inline-flex min-h-11 items-center justify-center rounded-xl px-5 font-bold text-primary-foreground disabled:opacity-60"
            >
              Enviar quiz
            </button>
          )}
          {!result && (
            <button
              onClick={reset}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-5 font-semibold"
            >
              Limpar respostas
            </button>
          )}
          {result && (
            <button
              onClick={reset}
              className="bg-brand inline-flex min-h-11 items-center justify-center rounded-xl px-5 font-bold text-primary-foreground"
            >
              Refazer quiz
            </button>
          )}
        </div>

        {history.length > 0 && !result && (
          <section className="mt-12">
            <h2 className="font-display text-xl font-bold">Histórico de quizzes</h2>
            <ul className="mt-4 space-y-2 text-sm">
              {history.slice(0, 5).map((h) => (
                <li
                  key={h.id}
                  className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-2"
                >
                  <span className="flex items-center gap-2">
                    {h.passed ? (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    ) : (
                      <XCircle className="h-4 w-4 text-warn" />
                    )}
                    <span>{new Date(h.created_at).toLocaleDateString("pt-BR")}</span>
                  </span>
                  <span className="font-semibold">
                    {h.score}/{h.total} ({h.percent}%)
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

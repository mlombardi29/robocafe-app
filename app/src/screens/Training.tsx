import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { trainingContent } from "../content/trainingContent";
import { supabase } from "../lib/supabase";
import { Button, Card, ErrorText, Screen, Title } from "../ui";

type Model = { id: string; code: string; name: string };
type Question = { id: string; position: number; prompt: string; choices: string[]; answer_index: number; explanation: string | null; draft: boolean };
type Progress = { model_id: string; status: string; reviewed_services: number };

const STATUS_LABEL: Record<string, string> = {
  in_training: "In training",
  quiz_passed: "Quiz passed",
  solo: "Solo",
  signed_off: "Signed off",
};

export function TrainingHome() {
  const { profile } = useAuth();
  const models = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const { data, error } = await supabase.from("models").select("id, code, name").order("code");
      if (error) throw new Error(error.message);
      return data as Model[];
    },
  });
  const progress = useQuery({
    queryKey: ["training", profile?.id],
    enabled: Boolean(profile),
    queryFn: async () => {
      const { data, error } = await supabase.from("training_progress").select("model_id, status, reviewed_services").eq("person_id", profile!.id);
      if (error) throw new Error(error.message);
      return data as Progress[];
    },
  });
  return (
    <Screen>
      <Title sub="Text guide for Sunday. Photos come later.">Training</Title>
      {trainingContent.draft ? (
        <p className="mb-4 rounded-2xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
          Draft for Michael to review. The quiz is not final.
        </p>
      ) : null}
      <div className="grid gap-3">
        {(models.data ?? []).map((model) => {
          const row = (progress.data ?? []).find((item) => item.model_id === model.id);
          return (
            <Link key={model.id} to={`/training/${model.code}`} className="block rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="text-xl font-semibold">{model.name}</div>
              <div className="text-sm text-stone-600">{STATUS_LABEL[row?.status ?? "in_training"]}</div>
            </Link>
          );
        })}
      </div>
    </Screen>
  );
}

export function TrainingModelPage() {
  const { code = "" } = useParams();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const model = useQuery({
    queryKey: ["model", code],
    queryFn: async () => {
      const { data, error: modelError } = await supabase.from("models").select("id, code, name").eq("code", code).maybeSingle();
      if (modelError || !data) throw new Error(modelError?.message ?? "Unknown model");
      return data as Model;
    },
  });
  const guide = useQuery({
    queryKey: ["guide", model.data?.id],
    enabled: Boolean(model.data),
    queryFn: async () => {
      const { data: template, error: templateError } = await supabase
        .from("checklist_templates")
        .select("id")
        .eq("model_id", model.data!.id)
        .eq("published", true)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (templateError || !template) throw new Error(templateError?.message ?? "No guide");
      const { data: sections, error: sectionError } = await supabase
        .from("checklist_sections")
        .select("id, title, position, checklist_items(title, position)")
        .eq("template_id", template.id)
        .order("position");
      if (sectionError) throw new Error(sectionError.message);
      return sections ?? [];
    },
  });
  const questions = useQuery({
    queryKey: ["quiz", model.data?.id],
    enabled: Boolean(model.data),
    queryFn: async () => {
      const { data, error: quizError } = await supabase
        .from("quiz_questions")
        .select("id, position, prompt, choices, answer_index, explanation, draft")
        .eq("model_id", model.data!.id)
        .order("position");
      if (quizError) throw new Error(quizError.message);
      return data as Question[];
    },
  });

  const why = trainingContent.why[code as keyof typeof trainingContent.why];

  async function submit() {
    if (!model.data) return;
    setBusy(true);
    setError("");
    const ordered = (questions.data ?? []).slice().sort((a, b) => a.position - b.position);
    const payload = ordered.map((question) => answers[question.position] ?? null);
    const { data, error: rpcError } = await supabase.rpc("submit_quiz", {
      p_model: model.data.id,
      p_answers: payload,
      p_key: crypto.randomUUID(),
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const row = data as { score: number; passed: boolean };
    setResult(row.passed ? `Passed (${row.score}). Status is now Quiz passed.` : `Not yet (${row.score}). You can try again.`);
    await queryClient.invalidateQueries({ queryKey: ["training"] });
  }

  return (
    <Screen>
      <Link to="/training" className="text-sm font-semibold text-[var(--accent)]">Training</Link>
      <Title sub={model.data?.name}>{model.data?.name ?? "Guide"}</Title>
      {why ? (
        <Card className="mb-4">
          <h2 className="font-semibold">Why</h2>
          {why.split("\n").filter(Boolean).map((line) => (
            <p key={line} className="mt-2 text-sm leading-relaxed text-stone-700">{line}</p>
          ))}
        </Card>
      ) : null}
      <div className="grid gap-3">
        {(guide.data ?? []).map((section) => (
          <Card key={section.id}>
            <h2 className="font-semibold">{section.title}</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-stone-700">
              {(section.checklist_items ?? [])
                .slice()
                .sort((a: { position: number }, b: { position: number }) => a.position - b.position)
                .map((item: { title: string }) => (
                  <li key={item.title}>{item.title}</li>
                ))}
            </ol>
          </Card>
        ))}
      </div>
      <Card className="mt-4">
        <h2 className="font-semibold">Photo list for the first three visits</h2>
        <p className="mt-1 text-sm text-stone-600">Text only for now. Upload is later.</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-stone-700">
          {trainingContent.photoShots.map((shot) => (
            <li key={shot}>{shot}</li>
          ))}
        </ol>
      </Card>
      <section className="mt-6">
        <h2 className="text-2xl font-semibold">Quiz</h2>
        <p className="text-sm text-stone-600">Pass mark 80%. You can retry. Draft for Michael to review.</p>
        <div className="mt-3 grid gap-4">
          {(questions.data ?? []).map((question, index) => (
            <Card key={question.id}>
              <p className="font-semibold">{index + 1}. {question.prompt}</p>
              <div className="mt-2 grid gap-2">
                {question.choices.map((choice, choiceIndex) => (
                  <button
                    key={choice}
                    type="button"
                    className={`min-h-12 rounded-2xl px-3 text-left text-sm ${answers[question.position] === choiceIndex ? "bg-[var(--accent)] text-white" : "bg-stone-100"}`}
                    onClick={() => setAnswers((current) => ({ ...current, [question.position]: choiceIndex }))}
                  >
                    {choice}
                  </button>
                ))}
              </div>
              {result && question.explanation ? <p className="mt-2 text-sm text-stone-600">{question.explanation}</p> : null}
            </Card>
          ))}
        </div>
        <Button className="mt-4 w-full" disabled={busy || !profile} onClick={() => void submit()}>
          {busy ? "Checking" : "Submit quiz"}
        </Button>
        {result ? <p className="mt-3 font-medium">{result}</p> : null}
        <ErrorText>{error}</ErrorText>
      </section>
    </Screen>
  );
}

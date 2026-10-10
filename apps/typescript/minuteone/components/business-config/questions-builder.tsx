import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Question } from "@/lib/config/schema";

const QUESTION_TYPES: Question["type"][] = ["text", "number", "boolean", "single_select"];
const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 5;

interface QuestionsBuilderProps {
  questions: Question[];
  onChange: (questions: Question[]) => void;
}

/** The full add/remove/edit qualification-questions list — no Card wrapper. */
export function QuestionsBuilder({ questions, onChange }: QuestionsBuilderProps) {
  function updateQuestion(index: number, patch: Partial<Question>) {
    onChange(questions.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  function addQuestion() {
    if (questions.length >= MAX_QUESTIONS) return;
    onChange([
      ...questions,
      { id: `question_${questions.length + 1}`, prompt: "", type: "text", weight: 10 },
    ]);
  }

  function removeQuestion(index: number) {
    if (questions.length <= MIN_QUESTIONS) return;
    onChange(questions.filter((_, i) => i !== index));
  }

  return (
    <div className="grid gap-4">
      {questions.map((question, index) => (
        <div key={index} className="grid gap-2 rounded-lg border p-3">
          <div className="grid gap-2">
            <Label>Prompt</Label>
            <Textarea
              value={question.prompt}
              onChange={(e) => updateQuestion(index, { prompt: e.target.value })}
              placeholder="What kind of service are you looking for?"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select
                value={question.type}
                onValueChange={(value) => updateQuestion(index, { type: value as Question["type"] })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUESTION_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Weight (0-100)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={question.weight}
                onChange={(e) => updateQuestion(index, { weight: Number(e.target.value) })}
              />
            </div>
          </div>
          {question.type === "single_select" && (
            <div className="grid gap-2">
              <Label>Options (comma-separated)</Label>
              <Input
                value={(question.options ?? []).join(", ")}
                onChange={(e) =>
                  updateQuestion(index, {
                    options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  })
                }
                placeholder="repair, installation, inspection, other"
              />
            </div>
          )}
          {(question.type === "single_select" || question.type === "boolean") && (
            <div className="grid gap-2">
              <Label>Qualifying answers (comma-separated, the ones that count as a positive signal)</Label>
              <Input
                value={(question.qualifyingAnswers ?? []).join(", ")}
                onChange={(e) =>
                  updateQuestion(index, {
                    qualifyingAnswers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  })
                }
                placeholder={question.type === "boolean" ? "true" : "repair, installation"}
              />
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            disabled={questions.length <= MIN_QUESTIONS}
            onClick={() => removeQuestion(index)}
          >
            Remove question
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" disabled={questions.length >= MAX_QUESTIONS} onClick={addQuestion}>
        Add question ({questions.length}/{MAX_QUESTIONS})
      </Button>
    </div>
  );
}

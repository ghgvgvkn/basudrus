/**
 * ExerciseOnboarding — the one-time "know you" questions (founder: "ask him
 * some questions once… just a little, to understand his goal"). Shown the
 * first time AI Exercise opens (no saved profile) and re-openable later via
 * the gear button to change goals. Powers the routine, calorie burn, and
 * injury-aware coaching.
 *
 * SAFETY: injuries here adapt exercise selection + cues only. Not medical
 * advice — the card says so.
 */
import { useState } from "react";
import {
  type FitnessProfile,
  type Goal,
  type Sex,
  type TrainPlace,
  type InjuryArea,
  GOAL_LABELS,
  INJURY_LABELS,
  saveProfile,
} from "./fitnessProfile";

interface Props {
  initial: FitnessProfile | null;
  onComplete: (p: FitnessProfile) => void;
  onCancel?: () => void;
}

const GOALS: Goal[] = ["muscle", "weight", "strength", "mobility"];
const SEXES: Array<{ id: Sex; label: string }> = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
  { id: "other", label: "Prefer not to say" },
];
const PLACES: Array<{ id: TrainPlace; label: string; emoji: string }> = [
  { id: "home", label: "Home", emoji: "🏠" },
  { id: "gym", label: "Gym", emoji: "🏋️" },
  { id: "both", label: "Both", emoji: "🔁" },
];
const INJURIES: InjuryArea[] = ["lower-back", "knees", "shoulders", "neck", "wrists", "hips", "ankles"];

export function ExerciseOnboarding({ initial, onComplete, onCancel }: Props) {
  const [goal, setGoal] = useState<Goal | null>(initial?.goal ?? null);
  const [height, setHeight] = useState(initial ? String(initial.heightCm) : "");
  const [weight, setWeight] = useState(initial ? String(initial.weightKg) : "");
  const [age, setAge] = useState(initial ? String(initial.age) : "");
  const [sex, setSex] = useState<Sex | null>(initial?.sex ?? null);
  const [place, setPlace] = useState<TrainPlace | null>(initial?.place ?? null);
  const [injuries, setInjuries] = useState<InjuryArea[]>(initial?.injuries ?? []);
  const [injuryNotes, setInjuryNotes] = useState(initial?.injuryNotes ?? "");

  const h = Number(height);
  const w = Number(weight);
  const a = Number(age);
  const valid =
    goal && sex && place &&
    h >= 100 && h <= 250 &&
    w >= 25 && w <= 300 &&
    a >= 12 && a <= 100;

  const toggleInjury = (i: InjuryArea) =>
    setInjuries((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));

  const submit = () => {
    if (!valid) return;
    const profile = saveProfile({
      goal: goal!,
      heightCm: Math.round(h),
      weightKg: Math.round(w),
      age: Math.round(a),
      sex: sex!,
      place: place!,
      injuries,
      injuryNotes: injuryNotes.trim(),
    });
    onComplete(profile);
  };

  return (
    <div className="exr-onboard">
      <div className="exr-onboard-card">
        <div className="exr-onboard-head">
          <div className="exr-onboard-title">{initial ? "Your training profile" : "Let's set up your coach"}</div>
          <div className="exr-onboard-sub">A few quick questions so Tony can tailor your workouts. You can change these anytime.</div>
        </div>

        <div className="exr-q">
          <label className="exr-q-label">What's your main goal?</label>
          <div className="exr-chips">
            {GOALS.map((g) => (
              <button key={g} className={`exr-chip ${goal === g ? "is-on" : ""}`} onClick={() => setGoal(g)}>
                {GOAL_LABELS[g]}
              </button>
            ))}
          </div>
        </div>

        <div className="exr-q exr-q-row">
          <div className="exr-field">
            <label className="exr-q-label">Height (cm)</label>
            <input className="exr-input" inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="175" />
          </div>
          <div className="exr-field">
            <label className="exr-q-label">Weight (kg)</label>
            <input className="exr-input" inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="72" />
          </div>
          <div className="exr-field">
            <label className="exr-q-label">Age</label>
            <input className="exr-input" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} placeholder="24" />
          </div>
        </div>

        <div className="exr-q">
          <label className="exr-q-label">Sex (for calorie estimates)</label>
          <div className="exr-chips">
            {SEXES.map((s) => (
              <button key={s.id} className={`exr-chip ${sex === s.id ? "is-on" : ""}`} onClick={() => setSex(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="exr-q">
          <label className="exr-q-label">Where do you train?</label>
          <div className="exr-chips">
            {PLACES.map((p) => (
              <button key={p.id} className={`exr-chip ${place === p.id ? "is-on" : ""}`} onClick={() => setPlace(p.id)}>
                {p.emoji} {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="exr-q">
          <label className="exr-q-label">Any injuries or areas to be careful with?</label>
          <div className="exr-chips">
            {INJURIES.map((i) => (
              <button key={i} className={`exr-chip ${injuries.includes(i) ? "is-on" : ""}`} onClick={() => toggleInjury(i)}>
                {INJURY_LABELS[i]}
              </button>
            ))}
          </div>
          {injuries.length > 0 && (
            <textarea
              className="exr-textarea"
              value={injuryNotes}
              onChange={(e) => setInjuryNotes(e.target.value)}
              placeholder="Anything specific? e.g. 'slight curve in my lower back, no heavy spinal loading'"
              rows={2}
            />
          )}
          <div className="exr-safety">
            ⚠️ Tony adapts your workout around these, but this isn't medical advice. Check with a
            professional, and stop any exercise that causes pain.
          </div>
        </div>

        <div className="exr-onboard-actions">
          {onCancel && (
            <button className="exr-cta exr-cta-ghost" onClick={onCancel}>Cancel</button>
          )}
          <button className="exr-cta" disabled={!valid} onClick={submit}>
            {initial ? "Save" : "Start training"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * ExerciseLibrary — browse ALL exercises in the catalog (the routine builder
 * deliberately picks only 6 per workout, which made the other ~60 invisible;
 * this screen is where they live). Search + filter by muscle / equipment /
 * difficulty, see honest webcam-detectability, and tap any move to start it
 * immediately as a single-exercise session with the camera coach.
 *
 * Injury-aware: moves your profile flags as "avoid" are shown but DIMMED
 * with the reason — visible honesty beats silent filtering.
 *
 * Rendered as an overlay INSIDE ExerciseMode (above the camera, below the
 * onboarding modal). Pure UI — selection is reported via onStart(steps).
 */
import { useMemo, useState } from "react";
import { EXERCISE_LIST } from "./exercises";
import { avoidedByInjury, repsForGoal, holdSecForGoal } from "./routine";
import type { ExerciseDef, RoutineStep } from "./types";
import type { FitnessProfile } from "./fitnessProfile";

interface ExerciseLibraryProps {
  profile: FitnessProfile | null;
  onStart: (steps: RoutineStep[]) => void;
  onClose: () => void;
}

/** Pretty label for the equipment filter chips. */
function equipmentLabel(eq: string): string {
  if (!eq || eq === "none") return "Bodyweight";
  return eq.charAt(0).toUpperCase() + eq.slice(1);
}

export function ExerciseLibrary({ profile, onStart, onClose }: ExerciseLibraryProps) {
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<string | null>(null);

  const muscles = useMemo(() => {
    const s = new Set<string>();
    for (const e of EXERCISE_LIST) if (e.primaryMuscles[0]) s.add(e.primaryMuscles[0]);
    return [...s].sort();
  }, []);
  const equipments = useMemo(() => {
    const s = new Set<string>();
    for (const e of EXERCISE_LIST) s.add(e.equipment || "none");
    return [...s].sort((a, b) => (a === "none" ? -1 : b === "none" ? 1 : a.localeCompare(b)));
  }, []);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EXERCISE_LIST.filter((e) => {
      if (muscle && e.primaryMuscles[0] !== muscle) return false;
      if (equipment && (e.equipment || "none") !== equipment) return false;
      if (q && !e.name.toLowerCase().includes(q) && !e.primaryMuscles.join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [query, muscle, equipment]);

  const startOne = (e: ExerciseDef) => {
    const step: RoutineStep =
      e.kind === "hold"
        ? { id: e.id, seconds: holdSecForGoal(profile?.goal), rest: 0 }
        : { id: e.id, reps: repsForGoal(profile?.goal), rest: 0 };
    onStart([step]);
  };

  return (
    <div className="exl-root" role="dialog" aria-label="Exercise library">
      <div className="exl-head">
        <div className="exl-title">
          Exercise library <span className="exl-count">{list.length} / {EXERCISE_LIST.length}</span>
        </div>
        <button className="exl-close" onClick={onClose} aria-label="Close library">✕</button>
      </div>

      <input
        className="exl-search"
        placeholder="Search moves or muscles…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="exl-filters">
        <div className="exl-chip-row">
          <button className={`exl-chip ${muscle === null ? "is-on" : ""}`} onClick={() => setMuscle(null)}>All muscles</button>
          {muscles.map((m) => (
            <button key={m} className={`exl-chip ${muscle === m ? "is-on" : ""}`} onClick={() => setMuscle(muscle === m ? null : m)}>
              {m}
            </button>
          ))}
        </div>
        <div className="exl-chip-row">
          {equipments.map((eq) => (
            <button
              key={eq}
              className={`exl-chip ${equipment === eq ? "is-on" : ""}`}
              onClick={() => setEquipment(equipment === eq ? null : eq)}
            >
              {equipmentLabel(eq)}
            </button>
          ))}
        </div>
      </div>

      <div className="exl-list">
        {list.map((e) => {
          const blocked = avoidedByInjury(e, profile?.injuries);
          return (
            <button
              key={e.id}
              className={`exl-item ${blocked ? "is-blocked" : ""}`}
              onClick={() => { if (!blocked) startOne(e); }}
              title={blocked ? "Not recommended for your flagged injuries" : `Start ${e.name}`}
            >
              <span className="exl-emoji">{e.emoji}</span>
              <span className="exl-item-text">
                <span className="exl-item-name">{e.name}</span>
                <span className="exl-item-meta">
                  {e.primaryMuscles.slice(0, 2).join(" · ")} · {equipmentLabel(e.equipment)} · {e.difficulty}
                  {e.detectable !== "high" ? ` · ${e.detectable === "medium" ? "partial" : "basic"} camera read` : ""}
                </span>
                {blocked && <span className="exl-item-warn">⚠ skipped for your injuries — edit profile to change</span>}
              </span>
              <span className="exl-go">{blocked ? "" : "▶"}</span>
            </button>
          );
        })}
        {list.length === 0 && <div className="exl-empty">No moves match — clear a filter.</div>}
      </div>
    </div>
  );
}

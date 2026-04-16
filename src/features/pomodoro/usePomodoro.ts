import { useState, useRef, useEffect } from "react";
import { useApp } from "@/context/AppContext";

const POMODORO_CONFIG = { work: 25 * 60, break: 5 * 60, longbreak: 15 * 60 } as const;

export function usePomodoro() {
  const { showNotif } = useApp();

  const [pomodoroActive, setPomodoroActive] = useState(false);
  const [pomodoroRunning, setPomodoroRunning] = useState(false);
  const [pomodoroSeconds, setPomodoroSeconds] = useState(25 * 60);
  const [pomodoroMode, setPomodoroMode] = useState<"work"|"break"|"longbreak">("work");
  const [pomodoroCount, setPomodoroCount] = useState(0);
  const pomodoroRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const pomodoroModeRef = useRef<"work"|"break"|"longbreak">("work");

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (pomodoroRef.current) { clearInterval(pomodoroRef.current); pomodoroRef.current = null; }
    };
  }, []);

  const startPomodoro = () => {
    if (pomodoroRef.current) clearInterval(pomodoroRef.current);
    setPomodoroRunning(true);
    pomodoroRef.current = setInterval(() => {
      setPomodoroSeconds(prev => {
        if (prev <= 1) {
          if (pomodoroRef.current) clearInterval(pomodoroRef.current);
          setPomodoroRunning(false);
          const mode = pomodoroModeRef.current;
          try { new Audio("data:audio/wav;base64,UklGRiQDAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQADAAB/f39/f39/f4B/gH+Af4F/gn+Df4R/hn+If4p/jH+Pf5J/ln+af55/on+mf6p/rn+yf7Z/un++f8J/xn/Jf8x/z3/Sf9V/13/Zf9t/3X/ef99/4H/hf+J/43/kf+V/5n/nf+h/6X/qf+t/7H/tf+5/73/wf/F/8n/zf/R/9X/2f/d/+H/5f/p/+3/8f/1//n//fwCAA").play(); } catch {}
          showNotif(mode === "work" ? "⏰ Break time! Great focus session." : "💪 Break over — back to studying!", "ok");
          setPomodoroCount(prev => {
            const next = mode === "work" ? prev + 1 : prev;
            if (mode === "work") {
              const newMode = (next) % 4 === 0 ? "longbreak" : "break";
              pomodoroModeRef.current = newMode;
              setPomodoroMode(newMode);
              setPomodoroSeconds(POMODORO_CONFIG[newMode]);
            } else {
              pomodoroModeRef.current = "work";
              setPomodoroMode("work");
              setPomodoroSeconds(POMODORO_CONFIG.work);
            }
            return next;
          });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const pausePomodoro = () => {
    setPomodoroRunning(false);
    if (pomodoroRef.current) { clearInterval(pomodoroRef.current); pomodoroRef.current = null; }
  };

  const resetPomodoro = () => {
    pausePomodoro();
    pomodoroModeRef.current = "work";
    setPomodoroMode("work");
    setPomodoroSeconds(POMODORO_CONFIG.work);
    setPomodoroCount(0);
    setPomodoroActive(false);
  };

  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const pomodoroProgress = (() => {
    const total = POMODORO_CONFIG[pomodoroMode];
    return ((total - pomodoroSeconds) / total) * 100;
  })();

  return {
    pomodoroActive, setPomodoroActive,
    pomodoroRunning, pomodoroSeconds, setPomodoroSeconds,
    pomodoroMode, setPomodoroMode,
    pomodoroCount,
    pomodoroConfig: POMODORO_CONFIG,
    pomodoroProgress, formatTime,
    startPomodoro, pausePomodoro, resetPomodoro,
  };
}

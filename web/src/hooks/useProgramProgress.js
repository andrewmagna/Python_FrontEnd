import { useEffect, useRef, useState } from "react";

// Tracks program progress by polling /api/opc/program-status at 100ms.
// pathsRef must be a React ref whose .current is the current 4-path array.
// Returns { running, stepIndex, passCount } where stepIndex is into the
// filtered active-paths array (passes > 0).
export function useProgramProgress(opcConnected, pathsRef) {
  const [programProgress, setProgramProgress] = useState({
    running: false,
    stepIndex: 0,
    passCount: 0,
  });

  const programStateRef = useRef({
    prevProgramStarted: false,
    prevCycleStarted: false,
    prevCycleCompleted: false,
    stepIndex: 0,
    passCount: 0,
  });

  useEffect(() => {
    if (!opcConnected) {
      programStateRef.current = {
        prevProgramStarted: false,
        prevCycleStarted: false,
        prevCycleCompleted: false,
        stepIndex: 0,
        passCount: 0,
      };
      setProgramProgress({ running: false, stepIndex: 0, passCount: 0 });
      return;
    }

    let cancelled = false;

    async function pollProgram() {
      try {
        const res = await fetch(`/api/opc/program-status?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();

        const ps = !!data.program_started;
        const cs = !!data.cycle_started;
        const cc = !!data.cycle_completed;
        const ref = programStateRef.current;
        const activePaths = (pathsRef.current || []).filter(
          (p) => (p.passes ?? 0) > 0,
        );

        let { stepIndex, passCount } = ref;

        if (ps && !ref.prevProgramStarted) {
          stepIndex = 0;
          passCount = 0;
        } else if (ps) {
          if (cs && !ref.prevCycleStarted) {
            passCount += 1;
          }
          if (cc && !ref.prevCycleCompleted) {
            const currentStep = activePaths[stepIndex];
            if (currentStep && passCount >= currentStep.passes) {
              let next = stepIndex + 1;
              while (
                next < activePaths.length &&
                (activePaths[next].passes ?? 0) === 0
              )
                next++;
              stepIndex =
                next < activePaths.length ? next : stepIndex;
              passCount = 0;
            }
          }
        }

        programStateRef.current = {
          prevProgramStarted: ps,
          prevCycleStarted: cs,
          prevCycleCompleted: cc,
          stepIndex,
          passCount,
        };
        if (!cancelled) setProgramProgress({ running: ps, stepIndex, passCount });
      } catch {
        // ignore — OPC disconnect is handled by the connection status poll
      }
    }

    pollProgram();
    const t = setInterval(pollProgram, 100);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [opcConnected]);

  return programProgress;
}

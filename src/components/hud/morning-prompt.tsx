import { CornerMark } from "@/components/mark";
import { Button } from "@/components/ui/button";
import { useFocusStore } from "@/lib/store";

export function MorningPrompt() {
  const answerMorning = useFocusStore((s) => s.answerMorning);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center p-4">
      <div
        className="backdrop-in absolute inset-0 bg-bg/45"
        aria-hidden
      />
      <div
        role="dialog"
        aria-labelledby="morning-title"
        aria-describedby="morning-desc"
        className="hud-panel modal-in relative z-10 w-full max-w-md px-8 py-8 text-center"
      >
        <div className="stagger-in flex flex-col items-center">
          <CornerMark className="mb-5 size-7 text-fg/80" />
          <p className="hud-kicker">Morning check-in</p>
          <h1
            id="morning-title"
            className="font-display mt-3 text-3xl leading-tight font-medium text-balance text-fg italic sm:text-4xl"
          >
            Bugun yangi tasklar bormi?
          </h1>
          <p
            id="morning-desc"
            className="mt-3 max-w-xs text-sm leading-normal text-pretty text-muted"
          >
            New tasks for today? Notes stay hidden unless you need them. Rules
            remain pinned either way.
          </p>
          <div className="mt-7 flex w-full max-w-xs gap-2">
            <Button
              variant="ghost"
              className="h-12 flex-1 rounded-md"
              onClick={() => answerMorning(false)}
            >
              Yo'q
            </Button>
            <Button
              className="h-12 flex-1 rounded-md"
              onClick={() => answerMorning(true)}
            >
              Ha
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

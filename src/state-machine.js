export const TARGET_STATES = Object.freeze({
  ARMED: "armed",
  BUY_READY: "buy_ready",
  QUEUE_BLOCKED: "queue_blocked",
  CONFIRM_READY: "confirm_ready",
  FAILED: "failed",
  STOPPED: "stopped"
});

export function createRuntimeState(logger) {
  const timestamps = {};
  let currentState = TARGET_STATES.ARMED;

  return {
    get current() {
      return currentState;
    },
    timestamps,
    async transition(nextState, details = {}) {
      if (currentState === nextState) {
        return;
      }

      currentState = nextState;
      await logger.info("State transition", { targetState: nextState, ...details });
    },
    mark(name, time = Date.now()) {
      timestamps[name] = time;
      return time;
    }
  };
}


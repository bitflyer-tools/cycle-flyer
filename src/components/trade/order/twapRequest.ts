import Stream from "xstream";
import sampleCombine from "xstream/extra/sampleCombine";
import {credentialsChanging$} from "../../../credentials";
import {TwapSliceRequest, twapSliceOrder} from "../../../http";
import {allocateSlices} from "../../../models/twapOrder";
import {State} from "./index";
import {TwapActions, TwapSchedule} from "./twapIntent";

type Started = { type: "started"; id: symbol; totalSlices: number };
type Stopped = { type: "stopped"; id: symbol; error?: string };
export type TwapLifecycle = Started | Stopped;

export const twapRequest = (actions: TwapActions, state$: Stream<State>, leaveTrade$ = Stream.never<void>()) => {
    let activeRun: symbol | undefined;
    const signingFailed$ = Stream.create<string>();
    const start$ = actions.onTwapStarted$.compose(sampleCombine(state$))
        .map(([schedule, state]) => ({ type: "start" as const, schedule, state }));
    const stop$ = Stream.merge(
        actions.onClickTwapCancelButton$.mapTo(undefined),
        leaveTrade$,
        credentialsChanging$.mapTo("TWAP stopped because credentials changed."),
        signingFailed$,
    ).map((error) => ({ type: "stop" as const, error: error || undefined }));

    const runs$ = Stream.merge(start$, stop$).map((command) => {
        if (command.type === "stop") {
            const id = activeRun;
            activeRun = undefined;
            return id ? { event: { type: "stopped", id, error: command.error } satisfies Stopped } : null;
        }

        const {schedule, state} = command;
        activeRun = schedule.id;
        const isActive = () => activeRun === schedule.id;
        return {
            event: { type: "started", id: schedule.id, totalSlices: state.twap.slices } satisfies Started,
            slices$: slices(state, schedule, isActive, () => {
                if (isActive()) {
                    signingFailed$.shamefullySendNext("TWAP stopped because an order could not be signed.");
                }
            }),
        };
    });

    return {
        lifecycle$: runs$.filter((run) => run !== null).map(({ event }): TwapLifecycle => event),
        requests$: runs$.map((run) => run?.slices$ ?? Stream.never<TwapSliceRequest>()).flatten(),
    };
};

const slices = (
    state: State, schedule: TwapSchedule, isTwapActive: () => boolean, onSigningFailure: () => void,
): Stream<TwapSliceRequest> => {
    const { baseSize, largerSize, largerCount } = allocateSlices(state.size, state.twap.slices);
    let subscription: { unsubscribe: () => void } | undefined;

    return Stream.create<TwapSliceRequest>({
        start: (listener) => {
            let gateOpen = true;
            let produced = 0;
            const queue: number[] = [];
            const produce = (tick: number): void => {
                if (!isTwapActive()) { return; }
                gateOpen = false;
                produced += 1;
                listener.next({
                    ...twapSliceOrder(tick + 1 < largerCount ? largerSize : baseSize, schedule.side, schedule.id),
                    isTwapActive,
                    onDispatched: release,
                    onSigningFailure,
                });
                if (produced === state.twap.slices) { listener.complete(); }
            };
            const release = (): void => {
                gateOpen = true;
                const tick = queue.shift();
                if (tick !== undefined) { produce(tick); }
            };
            subscription = Stream.periodic(state.twap.interval * 1000)
                .startWith(-1)
                .take(state.twap.slices)
                .filter(isTwapActive)
                .subscribe({
                    next: (tick) => { if (gateOpen) { produce(tick); } else { queue.push(tick); } },
                });
        },
        stop: () => subscription?.unsubscribe(),
    });
};

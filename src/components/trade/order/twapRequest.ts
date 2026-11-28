import {HTTPSource} from "@cycle/http";
import Stream from "xstream";
import sampleCombine from "xstream/extra/sampleCombine";
import {credentialsChanging$} from "../../../credentials";
import {unsignedRequests$} from "../../../drivers/httpDriver";
import {TwapSliceRequest, twapSliceOrder} from "../../../http";
import {allocateSlices} from "../../../models/twapOrder";
import {State} from "./index";
import {TwapActions, TwapSchedule} from "./twapIntent";

type Started = { type: "started"; id: symbol; totalSlices: number };
type Stopped = { type: "stopped"; id: symbol; error?: string };
export type TwapLifecycle = Started | Stopped;

export const twapRequest = (
    actions: TwapActions, state$: Stream<State>, http: HTTPSource, leaveTrade$ = Stream.never<void>(),
) => {
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
            slices$: slices(state, schedule, isActive, http, () => {
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
    state: State, schedule: TwapSchedule, isTwapActive: () => boolean,
    http: HTTPSource, onSigningFailure: () => void,
): Stream<TwapSliceRequest> => {
    const { baseSize, largerSize, largerCount } = allocateSlices(state.size, state.twap.slices);
    const isOwnSlice = (request: TwapSliceRequest) =>
        request.category === "twap-order" && request.scheduleId === schedule.id;
    const dispatched$ = http.select("twap-order")
        .filter((response$) => isOwnSlice(response$.request as TwapSliceRequest));
    const signingFailures$ = unsignedRequests$.filter((request) => isOwnSlice(request as TwapSliceRequest));
    const intervalMs = Math.ceil(state.twap.interval * 1000);

    let timer: ReturnType<typeof setTimeout> | undefined;
    let dispatchedSubscription: { unsubscribe: () => void } | undefined;
    let signingFailedSubscription: { unsubscribe: () => void } | undefined;

    return Stream.create<TwapSliceRequest>({
        start: (listener) => {
            let produced = 0;
            const produce = (): void => {
                if (!isTwapActive()) { return; }
                const size = produced < largerCount ? largerSize : baseSize;
                produced += 1;
                listener.next({
                    ...twapSliceOrder(size, schedule.side, schedule.id),
                    cancelled: () => !isTwapActive(),
                });
                if (produced === state.twap.slices) { listener.complete(); }
            };
            signingFailedSubscription = signingFailures$.subscribe({ next: onSigningFailure });
            dispatchedSubscription = dispatched$.subscribe({
                next: () => {
                    if (produced < state.twap.slices) { timer = setTimeout(produce, intervalMs); }
                },
            });
            produce();
        },
        stop: () => {
            clearTimeout(timer);
            dispatchedSubscription?.unsubscribe();
            signingFailedSubscription?.unsubscribe();
        },
    });
};

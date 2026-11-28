import {Response} from "@cycle/http";
import {Reducer} from "@cycle/state";
import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {Board, BoardLevels, isBoardLevels} from "../../../models/board";
import {BoardSnapshot} from "../../../models/boardSnapshot";
import {Execution} from "../../../models/execution";
import {State} from "./index";

interface UpdatableBoard {
    merge(asks: BoardLevels["asks"], bids: BoardLevels["bids"]): void;
    removeExecutions(executions: Execution[]): boolean | void;
}

type BoardUpdate = (board: UpdatableBoard) => boolean | void;
const snapshotDeadlineMs = 30_000;

interface PendingSnapshot {
    updates: BoardUpdate[];
    board?: Board;
    synchronized?: boolean;
    expired?: boolean;
}

export const synchronizeBoard = <T extends Stream<Response>>(
    deltas$: Stream<BoardLevels>,
    responses$$: Stream<T>,
    executions$: Stream<Execution[]>,
    connected$: Stream<boolean>,
): Stream<Reducer<State>> => {
    const boardUpdates$ = Stream.merge(
        deltas$.map<BoardUpdate>(({ asks, bids }) => (board) => board.merge(asks, bids)),
        executions$.filter((batch) => batch.length > 0)
            .map<BoardUpdate>((batch) => (board) => board.removeExecutions(batch)),
    );
    const liveReducer$ = boardUpdates$.map<Reducer<State>>((update) => (state) => {
        if (!state || update(state.board) === false) { return state; }
        return { ...state, boardRevision: (state.boardRevision ?? 0) + 1 };
    });
    const connection$ = connected$.compose(dropRepeats()).remember();
    const invalidation$ = connection$.mapTo(invalidateSnapshot);
    const snapshotReducer$ = snapshotReducers(
        responses$$.map<Stream<Response>>((response$) => response$), boardUpdates$, connection$,
    );

    return Stream.merge(liveReducer$, invalidation$, snapshotReducer$);
};

const invalidateSnapshot: Reducer<State> = (state) => state && ({ ...state, hasBoardSnapshot: false });

const snapshotReducers = (
    responses$$: Stream<Stream<Response>>,
    boardUpdates$: Stream<BoardUpdate>,
    connection$: Stream<boolean>,
): Stream<Reducer<State>> => {
    let nextRequest = 0;
    let latestApplied = 0;
    const installed$ = Stream.create<number>();
    return responses$$
        .map((response$) => {
            const request = ++nextRequest;
            const supersededBy$ = installed$.filter((installed) => installed > request);
            return reconcileSnapshot(response$, boardUpdates$, connection$, supersededBy$)
                .map((snapshot) => ({ request, ...snapshot }));
        })
        .compose(flattenConcurrently)
        .filter(({ request }) => request > latestApplied)
        .map<Reducer<State>>(({ request, board, synchronized }) => {
            latestApplied = request;
            installed$.shamefullySendNext(request);
            return (state) => state && ({ ...state, board, hasBoardSnapshot: synchronized === true });
        });
};

const reconcileSnapshot = (
    response$: Stream<Response>,
    boardUpdates$: Stream<BoardUpdate>,
    connection$: Stream<boolean>,
    supersededBy$: Stream<number>,
): Stream<PendingSnapshot & {board: Board}> => {
    const connectionUpdates$ = connection$.map((connected) => (pending: PendingSnapshot) => ({
        updates: [],
        synchronized: connected,
        expired: pending.synchronized !== undefined,
    }));
    const updates$ = boardUpdates$.map((update) => (pending: PendingSnapshot) => {
        if (pending.synchronized) { pending.updates.push(update); }
        return pending;
    });
    const snapshot$ = response$.map((response) => (pending: PendingSnapshot) => {
        const snapshot = decodeSnapshot(response.text);
        pending.updates.forEach((update) => update(snapshot));
        return { ...pending, board: snapshot.toBoard() };
    });

    return Stream.merge(connectionUpdates$, updates$, snapshot$)
        .endWhen(Stream.merge(supersededBy$, Stream.periodic(snapshotDeadlineMs).take(1)))
        .fold((pending, update) => update(pending), { updates: [] } as PendingSnapshot)
        .filter((pending) => pending.expired === true || !!pending.board)
        .take(1)
        .filter((pending): pending is PendingSnapshot & {board: Board} => !!pending.board)
        .replaceError(() => Stream.empty());
};

const decodeSnapshot = (text: string): BoardSnapshot => {
    const snapshot = JSON.parse(text);
    if (!isBoardLevels(snapshot)) {
        throw new Error("Invalid board snapshot");
    }
    return new BoardSnapshot(snapshot);
};

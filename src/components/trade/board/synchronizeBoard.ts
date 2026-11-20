import {Response} from "@cycle/http";
import {Reducer} from "@cycle/state";
import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import {Board, BoardLevels} from "../../../models/board";
import {State} from "./index";

interface PendingSnapshot {
    deltas: BoardLevels[];
    board?: Board;
    synchronized?: boolean;
}

export const synchronizeBoard = <T extends Stream<Response>>(
    deltas$: Stream<BoardLevels>,
    responses$$: Stream<T>,
    connected$: Stream<boolean>,
): Stream<Reducer<State>> => {
    const liveReducer$ = deltas$
        .map<Reducer<State>>((delta) => (state) => state && ({ ...state, board: mergeDelta(state.board, delta) }));

    const connection$ = connected$.compose(dropRepeats()).remember();
    const invalidation$ = connection$.mapTo(invalidateSnapshot);
    const snapshotReducer$ = snapshotReducers(responses$$, deltas$, connection$);

    return Stream.merge(liveReducer$, invalidation$, snapshotReducer$);
};

const invalidateSnapshot: Reducer<State> = (state) => state && ({ ...state, hasBoardSnapshot: false });

// Each response stream is announced at request time. Switching drops superseded requests.
const snapshotReducers = (
    responses$$: Stream<Stream<Response>>,
    deltas$: Stream<BoardLevels>,
    connection$: Stream<boolean>,
): Stream<Reducer<State>> =>
    responses$$
        .map((response$) => reconcileSnapshot(response$, deltas$, connection$))
        .flatten()
        .map<Reducer<State>>(({ board, synchronized }) => (state) =>
            state && ({ ...state, board, hasBoardSnapshot: synchronized === true }));

const reconcileSnapshot = (
    response$: Stream<Response>,
    deltas$: Stream<BoardLevels>,
    connection$: Stream<boolean>,
): Stream<PendingSnapshot & {board: Board}> => {
    const connectionUpdates$ = connection$.map((connected) => (pending: PendingSnapshot) => ({
        deltas: [],
        synchronized: pending.synchronized === undefined && connected,
    }));
    const updates$ = deltas$.map((delta) => (pending: PendingSnapshot) => {
        if (pending.synchronized) { pending.deltas.push(delta); }
        return pending;
    });
    const snapshot$ = response$.map((response) => (pending: PendingSnapshot) => ({
        ...pending,
        board: pending.deltas.reduce(mergeDelta, decodeSnapshot(response.text)),
    }));

    return Stream.merge(connectionUpdates$, updates$, snapshot$)
        .fold((pending, update) => update(pending), { deltas: [] } as PendingSnapshot)
        .filter((pending): pending is PendingSnapshot & {board: Board} => !!pending.board)
        .take(1)
        .replaceError(() => Stream.empty());
};

const mergeDelta = (board: Board, delta: BoardLevels): Board => board.merge(delta.asks, delta.bids);

const decodeSnapshot = (text: string): Board => {
    const snapshot = JSON.parse(text);
    if (!isBoardSide(snapshot?.asks) || !isBoardSide(snapshot?.bids)) {
        throw new Error("Invalid board snapshot");
    }
    return new Board(snapshot);
};

const isBoardSide = (orders: unknown): boolean =>
    Array.isArray(orders) && orders.every((order) =>
        Number.isFinite(order?.price) && Number.isFinite(order?.size));

import {Response} from "@cycle/http";
import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {Board, BoardLevels} from "../../../models/board";
import {State} from "./index";

interface PendingSnapshot {
    deltas: BoardLevels[];
    board?: Board;
}

export const synchronizeBoard = <T extends Stream<Response>>(
    deltas$: Stream<BoardLevels>,
    responses$$: Stream<T>,
    connected$: Stream<boolean>,
): Stream<Reducer<State>> => {
    const liveReducer$ = deltas$
        .map<Reducer<State>>((delta) => (state) => state && ({ ...state, board: mergeDelta(state.board, delta) }));

    const synchronizedReducer$ = connected$
        .map((connected) => connected
            ? snapshotReducers(responses$$, deltas$).startWith(invalidateSnapshot)
            : Stream.of(invalidateSnapshot))
        .flatten();

    return Stream.merge(liveReducer$, synchronizedReducer$);
};

const invalidateSnapshot: Reducer<State> = (state) => state && ({ ...state, hasBoardSnapshot: false });

// Each response stream is announced at request time. Switching drops superseded requests.
const snapshotReducers = (responses$$: Stream<Stream<Response>>, deltas$: Stream<BoardLevels>): Stream<Reducer<State>> =>
    responses$$
        .map((response$) => reconcileSnapshot(response$, deltas$))
        .flatten()
        .map<Reducer<State>>((board) => (state) => state && ({ ...state, board, hasBoardSnapshot: true }));

const reconcileSnapshot = (response$: Stream<Response>, deltas$: Stream<BoardLevels>): Stream<Board> => {
    const updates$ = deltas$.map((delta) => (pending: PendingSnapshot) => {
        pending.deltas.push(delta);
        return pending;
    });
    const snapshot$ = response$.map((response) => (pending: PendingSnapshot) => ({
        ...pending,
        board: pending.deltas.reduce(mergeDelta, decodeSnapshot(response.text)),
    }));

    return Stream.merge(updates$, snapshot$)
        .fold((pending, update) => update(pending), { deltas: [] } as PendingSnapshot)
        .map((pending) => pending.board)
        .filter((board): board is Board => !!board)
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

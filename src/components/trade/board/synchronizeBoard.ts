import {Response} from "@cycle/http";
import {Reducer} from "@cycle/state";
import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import {Board, BoardLevels} from "../../../models/board";
import {Execution} from "../../../models/execution";
import {State} from "./index";

type BoardUpdate = (board: Board) => void;

interface PendingSnapshot {
    updates: BoardUpdate[];
    board?: Board;
    synchronized?: boolean;
}

export const synchronizeBoard = <T extends Stream<Response>>(
    deltas$: Stream<BoardLevels>,
    responses$$: Stream<T>,
    executions$: Stream<Execution[]>,
    connected$: Stream<boolean>,
): Stream<Reducer<State>> => {
    const liveReducer$ = deltas$
        .map<Reducer<State>>((delta) => (state) => state && ({ ...state, board: mergeDelta(state.board, delta) }));

    const boardUpdates$ = Stream.merge(
        deltas$.map<BoardUpdate>((delta) => (board) => mergeDelta(board, delta)),
        executions$.filter((batch) => batch.length > 0)
            .map<BoardUpdate>((batch) => (board) => board.removeExecutions(batch)),
    );
    const connection$ = connected$.compose(dropRepeats()).remember();
    const invalidation$ = connection$.mapTo(invalidateSnapshot);
    const snapshotReducer$ = snapshotReducers(responses$$, boardUpdates$, connection$);

    return Stream.merge(liveReducer$, invalidation$, snapshotReducer$);
};

const invalidateSnapshot: Reducer<State> = (state) => state && ({ ...state, hasBoardSnapshot: false });

// Each response stream is announced at request time. Switching drops superseded requests.
const snapshotReducers = (
    responses$$: Stream<Stream<Response>>,
    boardUpdates$: Stream<BoardUpdate>,
    connection$: Stream<boolean>,
): Stream<Reducer<State>> =>
    responses$$
        .map((response$) => reconcileSnapshot(response$, boardUpdates$, connection$))
        .flatten()
        .map<Reducer<State>>(({ board, synchronized }) => (state) =>
            state && ({ ...state, board, hasBoardSnapshot: synchronized === true }));

const reconcileSnapshot = (
    response$: Stream<Response>,
    boardUpdates$: Stream<BoardUpdate>,
    connection$: Stream<boolean>,
): Stream<PendingSnapshot & {board: Board}> => {
    const connectionUpdates$ = connection$.map((connected) => (pending: PendingSnapshot) => ({
        updates: [],
        synchronized: pending.synchronized === undefined && connected,
    }));
    const updates$ = boardUpdates$.map((update) => (pending: PendingSnapshot) => {
        if (pending.synchronized) { pending.updates.push(update); }
        return pending;
    });
    const snapshot$ = response$.map((response) => (pending: PendingSnapshot) => {
        const board = decodeSnapshot(response.text);
        pending.updates.forEach((update) => update(board));
        return { ...pending, board };
    });

    return Stream.merge(connectionUpdates$, updates$, snapshot$)
        .fold((pending, update) => update(pending), { updates: [] } as PendingSnapshot)
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

import {Response} from "@cycle/http";
import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {Board} from "../../../models/board";
import {Execution} from "../../../models/execution";
import {State} from "./index";

type BoardUpdate = (board: Board) => void;

interface PendingSnapshot {
    updates: BoardUpdate[];
    board?: Board;
}

export const synchronizeBoard = <T extends Stream<Response>>(
    updates$: Stream<object>,
    responses$$: Stream<T>,
    executions$: Stream<Execution[]>,
): Stream<Reducer<State>> => {
    const deltas$ = updates$.map((json) => new Board(json));
    const liveReducer$ = deltas$
        .map<Reducer<State>>((delta) => (state) => state && ({ ...state, board: mergeDelta(state.board, delta) }));
    const boardUpdates$ = Stream.merge(
        deltas$.map<BoardUpdate>((delta) => (board) => mergeDelta(board, delta)),
        executions$.filter((batch) => batch.length > 0)
            .map<BoardUpdate>((batch) => (board) => board.removeExecutions(batch)),
    );

    // Each response stream is announced at request time. Switching drops superseded requests.
    const snapshotReducer$ = responses$$
        .map((response$) => reconcileSnapshot(response$, boardUpdates$))
        .flatten()
        .map<Reducer<State>>((board) => (state) => state && ({ ...state, board }));

    return Stream.merge(liveReducer$, snapshotReducer$);
};

const reconcileSnapshot = (response$: Stream<Response>, boardUpdates$: Stream<BoardUpdate>): Stream<Board> => {
    const updates$ = boardUpdates$.map((update) => (pending: PendingSnapshot) => {
        pending.updates.push(update);
        return pending;
    });
    const snapshot$ = response$.map((response) => (pending: PendingSnapshot) => {
        const board = decodeSnapshot(response.text);
        pending.updates.forEach((update) => update(board));
        return { ...pending, board };
    });

    return Stream.merge(updates$, snapshot$)
        .fold((pending, update) => update(pending), { updates: [] } as PendingSnapshot)
        .map((pending) => pending.board)
        .filter((board): board is Board => !!board)
        .take(1)
        .replaceError(() => Stream.empty());
};

const mergeDelta = (board: Board, delta: Board): Board => board.merge(delta.asks, delta.bids);

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

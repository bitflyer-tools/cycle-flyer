import {Response} from "@cycle/http";
import {Reducer} from "@cycle/state";
import Stream from "xstream";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {Board, BoardLevels} from "../../../models/board";
import {BoardSnapshot} from "../../../models/boardSnapshot";
import {Execution} from "../../../models/execution";
import {State} from "./index";

type BoardUpdate = (snapshot: BoardSnapshot) => void;
const snapshotDeadlineMs = 30_000;

interface PendingSnapshot {
    updates: BoardUpdate[];
    board?: Board;
}

export const synchronizeBoard = <T extends Stream<Response>>(
    deltas$: Stream<BoardLevels>,
    responses$$: Stream<T>,
    executions$: Stream<Execution[]>,
): Stream<Reducer<State>> => {
    const liveReducer$ = deltas$
        .map<Reducer<State>>((delta) => (state) => state && ({ ...state, board: mergeDelta(state.board, delta) }));
    const boardUpdates$ = Stream.merge(
        deltas$.map<BoardUpdate>(({ asks, bids }) => (snapshot) => snapshot.merge(asks, bids)),
        executions$.filter((batch) => batch.length > 0)
            .map<BoardUpdate>((batch) => (snapshot) => snapshot.removeExecutions(batch)),
    );

    let nextRequest = 0;
    let latestApplied = 0;
    const snapshotReducer$ = responses$$
        .map((response$) => {
            const request = ++nextRequest;
            return reconcileSnapshot(response$, boardUpdates$)
                .map((board) => ({ request, board }));
        })
        .compose(flattenConcurrently)
        .filter(({ request }) => request > latestApplied)
        .map<Reducer<State>>(({ request, board }) => {
            latestApplied = request;
            return (state) => state && ({ ...state, board });
        });

    return Stream.merge(liveReducer$, snapshotReducer$);
};

const reconcileSnapshot = (response$: Stream<Response>, boardUpdates$: Stream<BoardUpdate>): Stream<Board> => {
    const updates$ = boardUpdates$.map((update) => (pending: PendingSnapshot) => {
        pending.updates.push(update);
        return pending;
    });
    const snapshot$ = response$.map((response) => (pending: PendingSnapshot) => {
        const snapshot = decodeSnapshot(response.text);
        pending.updates.forEach((update) => update(snapshot));
        return { ...pending, board: snapshot.toBoard() };
    });

    return Stream.merge(updates$, snapshot$)
        .fold((pending, update) => update(pending), { updates: [] } as PendingSnapshot)
        .map((pending) => pending.board)
        .filter((board): board is Board => !!board)
        .take(1)
        .endWhen(Stream.periodic(snapshotDeadlineMs).take(1))
        .replaceError(() => Stream.empty());
};

const mergeDelta = (board: Board, delta: BoardLevels): Board => board.merge(delta.asks, delta.bids);

const decodeSnapshot = (text: string): BoardSnapshot => {
    const snapshot = JSON.parse(text);
    if (!isBoardSide(snapshot?.asks) || !isBoardSide(snapshot?.bids)) {
        throw new Error("Invalid board snapshot");
    }
    return new BoardSnapshot(snapshot);
};

const isBoardSide = (orders: unknown): boolean =>
    Array.isArray(orders) && orders.every((order) =>
        Number.isFinite(order?.price) && Number.isFinite(order?.size));

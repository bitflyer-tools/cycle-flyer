import {deepStrictEqual, strictEqual} from "node:assert";
import {test} from "node:test";
import {Board, BoardLevels} from "../src/models/board";
import {BoardOrder} from "../src/models/boardOrder";
import {estimateMarketFills} from "../src/models/marketFill";

test("merge replaces, removes, and sorts levels on both sides", () => {
    const board = new Board({
        asks: [{ price: 110, size: 1 }, { price: 120, size: 2 }, { price: 130, size: 3 }],
        bids: [{ price: 100, size: 4 }, { price: 90, size: 5 }, { price: 80, size: 6 }],
    });

    const result = board.merge(
        [{ price: 140, size: 7 }, { price: 120, size: 0 }, { price: 110, size: 8 }],
        [{ price: 70, size: 9 }, { price: 90, size: 0 }, { price: 100, size: 10 }],
    );

    strictEqual(result, board);
    deepStrictEqual(board.asks, [
        new BoardOrder({ price: 110, size: 8 }),
        new BoardOrder({ price: 130, size: 3 }),
        new BoardOrder({ price: 140, size: 7 }),
    ]);
    deepStrictEqual(board.bids, [
        new BoardOrder({ price: 100, size: 10 }),
        new BoardOrder({ price: 80, size: 6 }),
        new BoardOrder({ price: 70, size: 9 }),
    ]);
});

test("snapshots order asks and bids best first", () => {
    const board = new Board({
        asks: [{ price: 120, size: 1 }, { price: 110, size: 2 }],
        bids: [{ price: 90, size: 3 }, { price: 100, size: 4 }],
    });

    deepStrictEqual(board.asks.map(({price}) => price), [110, 120]);
    deepStrictEqual(board.bids.map(({price}) => price), [100, 90]);
    strictEqual(board.spread(), 10);
});

(["asks", "bids"] as const).forEach((side) => {
    const unchangedSide = side === "asks" ? "bids" : "asks";
    test(`merge skips all access to existing ${unchangedSide} for a delta to ${side} only`, () => {
        const board = new Board({
            asks: [{ price: 120, size: 1 }, { price: 110, size: 1 }],
            bids: [{ price: 90, size: 1 }, { price: 100, size: 1 }],
        });
        const original = board[unchangedSide];
        const untouched = new Proxy(original, {
            get() { throw new Error(`Unexpected access to ${unchangedSide}`); },
        });
        board[unchangedSide] = untouched;

        const delta: BoardLevels = { asks: [], bids: [] };
        delta[side].push({ price: 105, size: 2 });
        board.merge(delta.asks, delta.bids);

        strictEqual(board[unchangedSide], untouched);
        strictEqual(board[side][0].price, 105);
        board[unchangedSide] = original;
        strictEqual(board.spread(), 5);
    });
});

test("merge reads an existing price once when checking many changed prices", () => {
    const board = new Board({ asks: [], bids: [] });
    let priceReads = 0;
    board.asks = [{
        get price() {
            priceReads++;
            return 200;
        },
        size: 1,
    }];
    const updates = Array.from({ length: 100 }, (_, index) => new BoardOrder({
        price: 201 + index,
        size: 0,
    }));

    board.merge(updates, []);

    strictEqual(board.asks.length, 1);
    strictEqual(priceReads, 1);
});

test("estimates fills from raw levels in best-price order without changing the book", () => {
    const board = new Board({
        asks: [{ price: 120, size: 3 }, { price: 100, size: 1 }, { price: 99, size: 0 }],
        bids: [{ price: 80, size: 3 }, { price: 90, size: 1 }],
    });
    const before = JSON.stringify(board);

    deepStrictEqual(estimateMarketFills(board, 2), {
        buy: { status: "estimated", averagePrice: 110, priceDifferencePercent: 10 },
        sell: { status: "estimated", averagePrice: 85, priceDifferencePercent: -5 / 90 * 100 },
    });
    strictEqual(JSON.stringify(board), before);
});

test("handles exact decimal depth, insufficient depth, and unavailable sides", () => {
    const board = new Board({
        asks: [{ price: 100, size: 0.1 }, { price: 116, size: 0.7 }],
        bids: [],
    });
    const fills = estimateMarketFills(board, 0.8)!;
    strictEqual(fills.buy.status, "estimated");
    strictEqual(fills.buy.averagePrice, 114);
    strictEqual(fills.buy.priceDifferencePercent.toFixed(4), "14.0000");
    deepStrictEqual(fills.sell, { status: "unavailable" });
    deepStrictEqual(estimateMarketFills(board, 0.81), {
        buy: { status: "insufficient" },
        sell: { status: "unavailable" },
    });
    deepStrictEqual(estimateMarketFills(undefined, 1), {
        buy: { status: "unavailable" },
        sell: { status: "unavailable" },
    });
    [0, -1, NaN, Infinity].forEach((size) => strictEqual(estimateMarketFills(board, size), undefined));
});

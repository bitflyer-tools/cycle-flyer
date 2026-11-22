import {deepStrictEqual, ok, strictEqual} from "node:assert";
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
        [{ price: 140, size: 7 }, { price: 110, size: 0 }, { price: 120, size: 8 }, { price: 125, size: 11 }],
        [{ price: 70, size: 9 }, { price: 100, size: 0 }, { price: 90, size: 10 }, { price: 85, size: 12 }],
    );

    strictEqual(result, board);
    deepStrictEqual(board.asks, [
        new BoardOrder({ price: 120, size: 8 }),
        new BoardOrder({ price: 125, size: 11 }),
        new BoardOrder({ price: 130, size: 3 }),
        new BoardOrder({ price: 140, size: 7 }),
    ]);
    deepStrictEqual(board.bids, [
        new BoardOrder({ price: 90, size: 10 }),
        new BoardOrder({ price: 85, size: 12 }),
        new BoardOrder({ price: 80, size: 6 }),
        new BoardOrder({ price: 70, size: 9 }),
    ]);
    strictEqual(board.spread(), 30);
});

test("merge replaces all existing levels at a changed price and retains nonzero updates in input order", () => {
    const board = new Board({
        asks: [{ price: 110, size: 1 }, { price: 110, size: 2 }, { price: 120, size: 3 }],
        bids: [],
    });

    board.merge([{ price: 110, size: 4 }, { price: 110, size: 0 }, { price: 110, size: 5 }], []);

    deepStrictEqual(board.asks.map(({ size }) => size), [4, 5, 3]);
});

test("merge replaces a duplicate price with a single level on either side", () => {
    const board = new Board({
        asks: [{ price: 110, size: 1 }, { price: 110, size: 2 }, { price: 120, size: 3 }],
        bids: [{ price: 100, size: 1 }, { price: 90, size: 2 }, { price: 90, size: 3 }],
    });

    board.merge([{ price: 110, size: 4 }], [{ price: 90, size: 5 }]);

    deepStrictEqual(board.asks, [new BoardOrder({ price: 110, size: 4 }), new BoardOrder({ price: 120, size: 3 })]);
    deepStrictEqual(board.bids, [new BoardOrder({ price: 100, size: 1 }), new BoardOrder({ price: 90, size: 5 })]);
    strictEqual(board.spread(), 10);
});

test("repeated single-level replacements use logarithmic reads and reuse the side arrays", () => {
    const asks = Array.from({ length: 5_000 }, (_, index) => ({ price: 10_001 + index, size: 1 }));
    const bids = Array.from({ length: 5_000 }, (_, index) => ({ price: 10_000 - index, size: 1 }));
    const board = new Board({ asks, bids });
    const originalAsk = board.asks[2_499];
    const originalBid = board.bids[0];
    let levelReads = 0;
    const trackReads = (orders: BoardOrder[]) => new Proxy(orders, {
        get(target, key, receiver) {
            if (typeof key === "string" && /^\d+$/.test(key)) { levelReads++; }
            return Reflect.get(target, key, receiver);
        },
    });
    const liveAsks = board.asks = trackReads(board.asks);
    const liveBids = board.bids = trackReads(board.bids);

    const askUpdate = { price: 12_500, size: 1 };
    const bidUpdate = { price: 10_000, size: 1 };
    Array.from({ length: 100 }, (_, index) => index + 2).forEach((size) => {
        askUpdate.size = bidUpdate.size = size;
        board.merge([askUpdate], [bidUpdate]);
        strictEqual(board.spread(), 1);
    });
    askUpdate.size = bidUpdate.size = 0;

    strictEqual(board.asks, liveAsks);
    strictEqual(board.bids, liveBids);
    const maxReadsPerSide = Math.ceil(Math.log2(5_000)) + 2;
    const maxReads = 100 * (2 * maxReadsPerSide + 2);
    ok(levelReads <= maxReads, `Read ${levelReads} levels, expected at most ${maxReads}`);
    strictEqual(originalAsk.size, 1);
    strictEqual(originalBid.size, 1);
    deepStrictEqual(board.asks, asks.map(({ price }) =>
        new BoardOrder({ price, size: price === 12_500 ? 101 : 1 })));
    deepStrictEqual(board.bids, bids.map(({ price }) =>
        new BoardOrder({ price, size: price === 10_000 ? 101 : 1 })));
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

test("estimates an order matching the total depth across 100 decimal levels", () => {
    const board = new Board({
        asks: Array.from({ length: 100 }, (_, index) => ({ price: 100 + index, size: 0.03 })),
        bids: Array.from({ length: 100 }, (_, index) => ({ price: 99 - index / 2, size: 0.03 })),
    });

    const fills = estimateMarketFills(board, 3)!;
    strictEqual(fills.buy.status, "estimated");
    strictEqual(fills.sell.status, "estimated");
    strictEqual(fills.buy.averagePrice.toFixed(4), "149.5000");
    strictEqual(fills.sell.averagePrice.toFixed(4), "74.2500");
    deepStrictEqual(estimateMarketFills(board, 3.00000001), {
        buy: { status: "insufficient" },
        sell: { status: "insufficient" },
    });
});

const assert = require("node:assert/strict");
const {test} = require("node:test");
const Stream = require("xstream").default;
const {model} = require("../src/components/trade/model");
const {Board} = require("../src/models/board");
const {flattenStopOrders} = require("../src/models/parentStopOrders");

const parentOrder = {
    parent_order_id: "stop-parent",
    parameters: [{ condition_type: "STOP", side: "BUY", size: 1, trigger_price: 110 }],
};

function setup(t) {
    const executionBatch$ = Stream.create();
    const parentOrder$ = Stream.create();
    const parentOrders$ = Stream.create();
    const board = new Board({ asks: [{ price: 109, size: 2 }, { price: 110, size: 2 }], bids: [] });
    let state;
    const snapshots = [];
    const subscription = model({
        onCancelParentOrder$: Stream.never(),
        onExecutionBatch$: executionBatch$,
        onMyExecutionCreated$: Stream.never(),
        onOrdersLoaded$: Stream.never(),
        onParentOrderLoaded$: parentOrder$,
        onParentOrdersLoaded$: parentOrders$.map((orders) => ({ orders, sequence: 0 })),
        onPositionsLoaded$: Stream.never(),
    }).subscribe({
        next: (reducer) => {
            state = reducer(state);
            state = { ...state, boardComponentState: { board } };
            const stopOrders = flattenStopOrders(state.parentStopOrders);
            snapshots.push({
                price: state.currentPrice,
                stopOrders,
                stops: stopOrders.map((order) => order.price),
            });
        },
    });
    t.after(() => subscription.unsubscribe());
    parentOrders$.shamefullySendNext([parentOrder]);
    parentOrder$.shamefullySendNext(parentOrder);
    return { board, executionBatch$, parentOrder$, parentOrders$, snapshots };
}

test("a public execution batch prunes the board and updates the price while the active stop stays visible", (t) => {
    const { board, executionBatch$, parentOrder$, snapshots } = setup(t);
    const beforeExecution = snapshots.length;
    executionBatch$.shamefullySendNext([{ side: "BUY", price: 110 }, { side: "SELL", price: 108 }]);
    parentOrder$.shamefullySendNext(parentOrder);

    assert.deepEqual(board.asks.map(({ price }) => price), [110]);
    assert.equal(snapshots[beforeExecution].stopOrders, snapshots[beforeExecution - 1].stopOrders);
    assert.deepEqual(snapshots.slice(beforeExecution - 1).map(({ price, stops }) => ({ price, stops })), [
        { price: 0, stops: [110] },
        { price: 108, stops: [110] },
        { price: 108, stops: [110] },
    ]);
});

test("an inactive parent stays absent after a delayed detail and another refresh", (t) => {
    const { parentOrder$, parentOrders$, snapshots } = setup(t);
    const beforeRefresh = snapshots.length;
    parentOrders$.shamefullySendNext([]);
    parentOrder$.shamefullySendNext(parentOrder);
    parentOrders$.shamefullySendNext([]);

    assert.deepEqual(snapshots.slice(beforeRefresh - 1).map(({ stops }) => stops), [[110], [], [], []]);
});

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
    const execution$ = Stream.create();
    const parentOrder$ = Stream.create();
    const parentOrders$ = Stream.create();
    const board = new Board({ asks: [{ price: 110, size: 2 }], bids: [] });
    let state;
    const snapshots = [];
    const subscription = model({
        onExecutionCreated$: execution$,
        onMyExecutionCreated$: Stream.never(),
        onOrdersLoaded$: Stream.never(),
        onParentOrderLoaded$: parentOrder$,
        onParentOrdersLoaded$: parentOrders$,
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
    return { board, execution$, parentOrder$, parentOrders$, snapshots };
}

test("a public execution updates the market price while the active stop stays visible", (t) => {
    const { board, execution$, parentOrder$, snapshots } = setup(t);
    const beforeExecution = snapshots.length;
    execution$.shamefullySendNext({ side: "BUY", price: 110 });
    parentOrder$.shamefullySendNext(parentOrder);

    assert.equal(board.asks[0].price, 110);
    assert.equal(snapshots[beforeExecution].stopOrders, snapshots[beforeExecution - 1].stopOrders);
    assert.deepEqual(snapshots.slice(beforeExecution - 1).map(({ price, stops }) => ({ price, stops })), [
        { price: 0, stops: [110] },
        { price: 110, stops: [110] },
        { price: 110, stops: [110] },
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

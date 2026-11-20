# Architecture

Cycle Flyer is an Electron desktop client for bitFlyer Lightning. The renderer is
written in TypeScript with Cycle.js and xstream.

## Desktop shell and renderer

- [`srcElectron/index.js`](../srcElectron/index.js) opens the Electron window and
  loads [`public/index.html`](../public/index.html).
- [`src/index.ts`](../src/index.ts) starts the renderer and connects the DOM,
  HTTP, history, socket, sound, and storage drivers.
- [`src/components/index.ts`](../src/components/index.ts) routes between **Trade**
  and **Setting**. The Trade state is scoped under the root, so it can survive
  navigation between screens.

## Components and data flow

Start with a component's `index.ts` to see how it connects driver inputs to
output streams. In each screen, `intent.ts` converts incoming events into actions,
`model.ts` produces state reducers, and `view.ts` renders state. Components that
send HTTP requests also use a `request.ts` module.

- [Trade](../src/components/trade/index.ts) composes the order book, order form,
  and account summary. It shares the selected price, active orders, and position
  with the panels that need them.
- [Setting](../src/components/setting/index.ts) writes API credentials and the
  sound preference through the storage driver.
- [`src/http.ts`](../src/http.ts) builds bitFlyer REST requests, including request
  signatures. [The Socket.IO driver](../src/drivers/socketIODriver.ts) provides
  live order book updates, public executions, and authenticated order events.

## Follow an order book update

1. [The board component](../src/components/trade/board/index.ts) passes live
   socket updates and REST snapshot responses to the synchronization code. It
   requests a snapshot when it starts and every 15 seconds afterward.
2. [`synchronizeBoard.ts`](../src/components/trade/board/synchronizeBoard.ts)
   applies live updates to the current board. When a snapshot arrives, it
   reapplies the updates received while that request was in flight before
   replacing the board.
3. [The board view](../src/components/trade/board/view.ts) renders the bids, asks,
   and spread from the resulting state. Start with the
   [synchronization tests](../test/boardSynchronization.ts) when changing how
   snapshots and live updates are combined.

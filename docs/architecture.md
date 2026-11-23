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
- [Setting](../src/components/setting/index.ts) writes the sound preference
  through the storage driver.
- [`src/http.ts`](../src/http.ts) builds bitFlyer REST requests.
  [The Socket.IO driver](../src/drivers/socketIODriver.ts) provides
  live order book updates, public executions, and authenticated order events.

## Credential saving and REST signing

1. **Save credentials** submits the Settings form. The [Settings intent](../src/components/setting/intent.ts)
   reads the key and secret and calls `saveCredentials` in the
   [renderer credential service](../src/credentials.ts).
2. In Electron, the service calls the [preload bridge](../srcElectron/preload.js),
   which forwards the save over IPC to the [main process](../srcElectron/index.js).
   The [credential store](../srcElectron/credentials.js) encrypts the pair with
   Electron's `safeStorage` and writes `bitflyer-credentials.enc` under the app's
   `userData` directory. In a standalone browser, the renderer credential service
   keeps the pair in memory for the current page session. Reloading the page
   clears it.
3. Before dispatching a private bitFlyer REST request under `/v1/me/`, the
   [signed HTTP driver](../src/drivers/httpDriver.ts) calls the credential
   service's `signRest` with the method, path (including the query string), and
   body. Electron delegates signing through the same preload bridge to the
   main-process credential store. In the browser, the credential service signs
   with the in-memory pair. The driver adds the returned `ACCESS-KEY`,
   `ACCESS-SIGN`, and `ACCESS-TIMESTAMP` headers before sending the request.

## Follow an order book update

1. [The board component](../src/components/trade/board/index.ts) passes live
   socket updates and REST snapshot responses to the synchronization code. The
   first socket connection state (connected or disconnected) triggers a REST
   snapshot. Each change in that state, including disconnects and reconnects,
   triggers another snapshot. A separate timer requests a snapshot every
   15 seconds regardless of connection state.
2. [`synchronizeBoard.ts`](../src/components/trade/board/synchronizeBoard.ts)
   applies live updates to the current board. A connection transition clears
   the board's synchronized flag and expires all in-flight snapshots, so their
   responses are ignored. A snapshot requested while connected buffers live
   board deltas and execution updates while the request is in flight. If the
   response is accepted, those updates are replayed before the snapshot replaces
   the board and marks it synchronized. A snapshot accepted while disconnected
   can replace the board with no replay and leaves the synchronized flag unset.
3. [The board view](../src/components/trade/board/view.ts) renders the bids, asks,
   and spread from the resulting state. Start with the
   [synchronization tests](../test/boardSynchronization.ts) when changing how
   snapshots and live updates are combined.

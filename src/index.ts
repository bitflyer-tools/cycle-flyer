import {makeDOMDriver} from "@cycle/dom";
import {makeHistoryDriver, captureClicks} from "@cycle/history";
import {makeHTTPDriver} from "@cycle/http";
import {run} from "@cycle/run";
import onionify from "cycle-onionify";
import {routerify} from "cyclic-router";
import switchPath from "switch-path";
import {Root} from "./components/index";
import storageDriver from "@cycle/storage";
import {makePubnubDriver} from "./drivers/pubnubDriver";
import "./index.styl";

run(routerify(onionify(Root), switchPath), {
    DOM: makeDOMDriver("#app"),
    HTTP: makeHTTPDriver(),
    history: captureClicks(makeHistoryDriver()),
    pubnub: makePubnubDriver(),
    storage: storageDriver
});
